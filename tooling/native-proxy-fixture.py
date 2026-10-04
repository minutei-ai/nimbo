"""Real HTTP/TLS origins and forwarding HTTP/CONNECT/SOCKS5 test servers."""
import base64
import collections
import gzip
import contextlib
import http.client
import http.server
import json
import os
import pathlib
import secrets
import select
import socket
import socketserver
import ssl
import subprocess
import sys
import tempfile
import threading
import time
import urllib.parse


class Origin(http.server.BaseHTTPRequestHandler):
    protocol_version = 'HTTP/1.1'

    def setup(self):
        super().setup()
        self.connection.setsockopt(socket.IPPROTO_TCP, socket.TCP_NODELAY, 1)

    def log_message(self, *_args):
        pass

    def do_GET(self):
        self.reply()

    def do_POST(self):
        self.reply()

    def reply(self):
        try:
            self.respond()
        except OSError:
            # Limit/certificate/cancellation checks deliberately close sockets.
            pass

    def respond(self):
        length = int(self.headers.get('Content-Length', '0'))
        body = self.rfile.read(length)
        with self.server.lock:
            self.server.requests.append((self.path, self.command, body,
                                         self.headers.get('Cookie', ''),
                                         self.headers.get('Proxy-Authorization') or self.headers.get('Authorization')))
        if self.wire():
            return
        routes = {
            '/empty': ('text/html', '<!doctype html><body>empty'),
            '/page': ('text/html', '<!doctype html><link rel="stylesheet" href="/style.css">'
                      '<body><div id="value"></div><script src="/boot.js"></script>'
                      '<script type="module" src="/app.mjs"></script>'),
            '/boot.js': ('text/javascript', "globalThis.result=fetch('/data',{method:'POST',body:'payload'})"
                         ".then(r=>r.json()).then(v=>{document.querySelector('#value').textContent=v.value;return v.value})"),
            '/app.mjs': ('text/javascript', "import {suffix} from '/dep.mjs';globalThis.suffix=suffix"),
            '/dep.mjs': ('text/javascript', "export const suffix='module'"),
            '/style.css': ('text/css', '#value{width:24px;height:12px}'),
            '/data': ('application/json', '{"value":"through-proxy"}'),
        }
        if self.path == '/start':
            self.send_response(302)
            self.send_header('Location', '/page')
            self.send_header('Set-Cookie', 'transport=retained; Path=/')
            data, content_type = b'', 'text/html'
        else:
            content_type, text = routes.get(self.path, ('text/plain', 'Not found'))
            data = text.encode()
            self.send_response(200 if self.path in routes else 404)
        self.send_header('Content-Type', content_type)
        self.send_header('Content-Length', str(len(data)))
        self.send_header('Connection', 'close')
        self.end_headers()
        self.wfile.write(data)


    def wire(self):
        paths = ('/chunked', '/gzip', '/no-length', '/large', '/gzip-bomb',
                 '/large-header', '/truncated', '/ambiguous', '/malformed-chunk', '/stall')
        if self.path not in paths:
            return False
        data = b'framed-response'
        if self.path in ('/large', '/gzip-bomb'):
            data = b'x' * (3 * 1024 * 1024)
        self.send_response(200)
        self.send_header('Content-Type', 'text/plain')
        self.send_header('Connection', 'close')
        if self.path in ('/gzip', '/gzip-bomb'):
            data = gzip.compress(data)
            self.send_header('Content-Encoding', 'gzip')
        if self.path == '/large-header':
            self.send_header('X-Fixture', 'x' * 20000)
        if self.path in ('/chunked', '/malformed-chunk', '/ambiguous'):
            self.send_header('Transfer-Encoding', 'chunked')
            if self.path == '/ambiguous':
                self.send_header('Content-Length', str(len(data)))
            self.end_headers()
            if self.path == '/malformed-chunk':
                self.wfile.write(b'not-hex\r\n')
            else:
                self.wfile.write(b'4;fixture=yes\r\n' + data[:4] + b'\r\n' +
                                 f'{len(data[4:]):x}\r\n'.encode() + data[4:] +
                                 b'\r\n0\r\nX-Fixture-Trailer: complete\r\n\r\n')
        else:
            if self.path != '/no-length':
                self.send_header('Content-Length', str(len(data) + (5 if self.path == '/truncated' else 0)))
            self.end_headers()
            if self.path == '/stall':
                time.sleep(12)
            self.wfile.write(data)
        return True


class Proxy(socketserver.StreamRequestHandler):
    def handle(self):
        self.connection.settimeout(4)
        self.connection.setsockopt(socket.IPPROTO_TCP, socket.TCP_NODELAY, 1)
        try:
            if self.server.mode.startswith('socks'):
                self.socks()
            else:
                self.http()
        except (OSError, ValueError, http.client.HTTPException):
            # A rejected client or closed connection is expected in failure tests.
            pass

    def authorize(self, username, password):
        return not self.server.auth or (username, password) == self.server.auth

    def target(self, host, port):
        if host not in ('127.0.0.1', '::1', 'localhost', 'example.test', 'mismatch.test') or port not in self.server.ports:
            raise ValueError('Destination outside synthetic fixture')
        with self.server.lock:
            self.server.targets.append((host, port))
        upstream = socket.create_connection(('127.0.0.1', port), timeout=4)
        upstream.setsockopt(socket.IPPROTO_TCP, socket.TCP_NODELAY, 1)
        return upstream

    def relay(self, upstream):
        with upstream:
            while True:
                ready, _, _ = select.select([self.connection, upstream], [], [], 20)
                if not ready:
                    return
                for source in ready:
                    data = source.recv(65536)
                    if not data:
                        return
                    (upstream if source is self.connection else self.connection).sendall(data)

    def http(self):
        line = self.rfile.readline(8192).decode().strip()
        method, target, _version = line.split(' ', 2)
        headers = http.client.parse_headers(self.rfile)
        if self.server.auth:
            expected = 'Basic ' + base64.b64encode(':'.join(self.server.auth).encode()).decode()
            if headers.get('Proxy-Authorization') != expected:
                self.wfile.write(b'HTTP/1.1 407 Proxy Authentication Required\r\nContent-Length: 0\r\nConnection: close\r\n\r\n')
                return
        if method == 'CONNECT':
            host, port = target.rsplit(':', 1)
            upstream = self.target(host, int(port))
            self.wfile.write(b'HTTP/1.1 200 Connection Established\r\n\r\n')
            self.wfile.flush()
            self.relay(upstream)
            return
        url = urllib.parse.urlsplit(target)
        if url.scheme != 'http':
            raise ValueError('Expected absolute HTTP request')
        connection = http.client.HTTPConnection('127.0.0.1', url.port or 80, timeout=4)
        connection.sock = self.target(url.hostname, url.port or 80)
        try:
            body = self.rfile.read(int(headers.get('Content-Length', '0')))
            forwarded = {k: v for k, v in headers.items()
                         if k.lower() not in ('proxy-authorization', 'proxy-connection', 'connection')}
            connection.request(method, urllib.parse.urlunsplit(('', '', url.path, url.query, '')),
                               body=body, headers=forwarded)
            response = connection.getresponse()
            data = response.read()
            self.wfile.write(f'HTTP/1.1 {response.status} {response.reason}\r\n'.encode())
            for key, value in response.getheaders():
                if key.lower() not in ('content-length', 'connection', 'transfer-encoding'):
                    self.wfile.write(f'{key}: {value}\r\n'.encode())
            if response.getheader('Transfer-Encoding') == 'chunked':
                self.wfile.write(b'Transfer-Encoding: chunked\r\nConnection: close\r\n\r\n')
                self.wfile.write(f'{len(data):x};fixture=forwarded\r\n'.encode() + data + b'\r\n0\r\n\r\n')
            else:
                if response.getheader('Content-Length') is not None:
                    self.wfile.write(f'Content-Length: {len(data)}\r\n'.encode())
                self.wfile.write(b'Connection: close\r\n\r\n')
                self.wfile.write(data)
        finally:
            connection.close()

    def exact(self, length):
        data = self.rfile.read(length)
        if len(data) != length:
            raise ValueError('Truncated SOCKS request')
        return data

    def socks(self):
        version, count = self.exact(2)
        methods = self.exact(count)
        selected = 2 if self.server.auth else 0
        if version != 5 or selected not in methods:
            self.wfile.write(b'\x05\xff')
            return
        self.wfile.write(bytes((5, selected)))
        self.wfile.flush()
        if selected == 2:
            version, length = self.exact(2)
            username = self.exact(length).decode()
            password = self.exact(self.exact(1)[0]).decode()
            accepted = version == 1 and self.authorize(username, password)
            self.wfile.write(bytes((1, 0 if accepted else 1)))
            self.wfile.flush()
            if not accepted:
                return
        version, command, reserved, kind = self.exact(4)
        if (version, command, reserved) != (5, 1, 0):
            raise ValueError('Expected SOCKS5 CONNECT')
        if kind == 1:
            host = socket.inet_ntop(socket.AF_INET, self.exact(4))
        elif kind == 3:
            host = self.exact(self.exact(1)[0]).decode()
        elif kind == 4:
            host = socket.inet_ntop(socket.AF_INET6, self.exact(16))
        else:
            raise ValueError('Invalid SOCKS address')
        port = int.from_bytes(self.exact(2), 'big')
        upstream = self.target(host, port)
        self.wfile.write(b'\x05\x00\x00\x01\x7f\x00\x00\x01\x00\x00')
        self.wfile.flush()
        self.relay(upstream)


@contextlib.contextmanager
def running(server):
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        yield server
    finally:
        server.shutdown()
        server.server_close()
        thread.join()


def origin(context=None):
    server = http.server.ThreadingHTTPServer(('127.0.0.1', 0), Origin)
    server.daemon_threads = True
    server.lock, server.requests = threading.Lock(), []
    if context:
        server.socket = context.wrap_socket(server.socket, server_side=True)
    return server


def proxy(mode, ports, auth=None, context=None):
    server = socketserver.ThreadingTCPServer(('127.0.0.1', 0), Proxy)
    server.daemon_threads = True
    server.mode, server.ports, server.auth = mode, ports, auth
    server.lock, server.targets = threading.Lock(), []
    if context:
        server.socket = context.wrap_socket(server.socket, server_side=True)
    return server


def invoke(binary, env, url, proxy_url=None, flag=False):
    args = [binary]
    child_env = dict(env)
    child_env.pop('NIMBO_PROXY_URL', None)
    if proxy_url is not None:
        if flag:
            args += ['--proxy', proxy_url]
        else:
            child_env['NIMBO_PROXY_URL'] = proxy_url
    args += [url, "result.then(v=>({value:v,text:document.querySelector('#value').textContent,suffix:globalThis.suffix,cookie:document.cookie}))"]
    return subprocess.run(args, env=child_env, capture_output=True, text=True, timeout=15)


def certificates(root):
    cert, key, ca, ca_key = (root / name for name in ('cert.pem', 'key.pem', 'ca.pem', 'ca-key.pem'))
    commands = [
        ['openssl', 'req', '-x509', '-newkey', 'rsa:2048', '-nodes',
         '-keyout', str(ca_key), '-out', str(ca), '-days', '1',
         '-subj', '/CN=Nimbo synthetic test CA', '-addext', 'basicConstraints=critical,CA:TRUE'],
        ['openssl', 'req', '-new', '-newkey', 'rsa:2048', '-nodes',
         '-keyout', str(key), '-out', str(root / 'request.pem'), '-subj', '/CN=example.test'],
        ['openssl', 'x509', '-req', '-in', str(root / 'request.pem'),
         '-CA', str(ca), '-CAkey', str(ca_key), '-CAcreateserial',
         '-out', str(cert), '-days', '1', '-extfile', str(root / 'extensions.cnf')],
    ]
    (root / 'extensions.cnf').write_text(
        'basicConstraints=critical,CA:FALSE\n'
        'keyUsage=critical,digitalSignature,keyEncipherment\n'
        'extendedKeyUsage=serverAuth\n'
        'subjectAltName=DNS:example.test,DNS:localhost,IP:127.0.0.1\n')
    for command in commands:
        subprocess.run(command, check=True, capture_output=True)
    context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
    context.load_cert_chain(cert, key)
    return context, ca


def main(binary):
    with tempfile.TemporaryDirectory(prefix='nimbo-proxy-') as directory:
        root = pathlib.Path(directory)
        context, ca = certificates(root)
        env = dict(os.environ, SSL_CERT_FILE=str(ca))
        counts = collections.Counter()
        with running(origin()) as http, running(origin(context)) as https:
            ports = (http.server_port, https.server_port)
            for mode in ('http', 'http-auth', 'https-auth', 'socks5', 'socks5-auth', 'socks5h-auth'):
                credentials = (secrets.token_hex(8) + '@', secrets.token_hex(12) + ':/% café') if 'auth' in mode else None
                with running(proxy(mode, ports, credentials, context if mode.startswith('https') else None)) as relay:
                    scheme = mode.split('-')[0]
                    authority = '127.0.0.1:' + str(relay.server_address[1])
                    if credentials:
                        authority = ':'.join(urllib.parse.quote(value, safe='') for value in credentials) + '@' + authority
                    proxy_url = scheme + '://' + authority
                    for variant in range(64):
                        secure = variant % 2 == 1
                        host = 'localhost' if scheme == 'socks5' else 'example.test'
                        url = ('https' if secure else 'http') + '://' + host + ':' + str(ports[secure]) + '/start'
                        result = invoke(binary, env, url, proxy_url, flag=variant % 3 == 0)
                        if result.returncode:
                            raise AssertionError(mode + ': extraction failed: ' + result.stderr.replace(proxy_url, '[proxy]'))
                        assert json.loads(result.stdout) == {'value': 'through-proxy', 'text': 'through-proxy',
                                                            'suffix': 'module', 'cookie': 'transport=retained'}
                        counts[mode] += 1
                    assert relay.targets
                    if scheme == 'socks5':
                        assert all(host in ('127.0.0.1', '::1') for host, _port in relay.targets)
                    if scheme == 'socks5h':
                        assert all(host == 'example.test' for host, _port in relay.targets)
                    if credentials:
                        before = len(http.requests)
                        rejected = invoke(binary, env, f'http://127.0.0.1:{http.server_port}/start',
                                          scheme + '://wrong:wrong@127.0.0.1:' + str(relay.server_address[1]))
                        assert rejected.returncode != 0 and len(http.requests) == before
                        assert all(secret not in rejected.stderr for secret in credentials)
                        counts['authentication-rejections'] += 1
            expected = collections.Counter({'/start': 192, '/page': 192, '/style.css': 192,
                                            '/boot.js': 192, '/app.mjs': 192, '/dep.mjs': 192, '/data': 192})
            for server in (http, https):
                assert collections.Counter(path for path, *_rest in server.requests) == expected
                assert all(auth is None for _path, _method, _body, _cookie, auth in server.requests)
                assert all(cookie == 'transport=retained' for path, _method, _body, cookie, _auth in server.requests if path != '/start')
                assert all(method == 'POST' and body == b'payload' for path, method, body, _cookie, _auth in server.requests if path == '/data')
            with running(proxy('http', ports)) as relay:
                before = len(https.requests)
                rejected = invoke(binary, env, f'https://mismatch.test:{https.server_port}/start',
                                  'http://127.0.0.1:' + str(relay.server_address[1]))
                assert rejected.returncode != 0 and len(https.requests) == before
                assert relay.targets == [('mismatch.test', https.server_port)]
                counts['TLS-hostname-rejections'] += 1
            # A dead configured proxy must not be bypassed, even when the origin is reachable directly.
            with socket.socket() as dead:
                dead.bind(('127.0.0.1', 0))
                port = dead.getsockname()[1]
            before = len(http.requests)
            rejected = invoke(binary, env, f'http://127.0.0.1:{http.server_port}/start', f'http://127.0.0.1:{port}')
            assert rejected.returncode != 0 and len(http.requests) == before
            counts['no-direct-fallback'] += 1
            for value in ('', 'ftp://example.test', 'http://redacted:private@example.test/path',
                          'http://redacted:private@example.test/?query', 'http://redacted:private@example.test/#fragment'):
                rejected = invoke(binary, env, f'http://127.0.0.1:{http.server_port}/start', value)
                assert rejected.returncode != 0 and 'invalid proxy configuration' in rejected.stderr
                assert 'redacted' not in rejected.stderr and 'private' not in rejected.stderr
                counts['invalid-configurations'] += 1
            print(json.dumps({'scope': 'real HTTP/TLS origins and forwarding proxies; native CLI; no mocks',
                              'passed': dict(counts), 'origin_requests': len(http.requests) + len(https.requests)}))


def serve():
    with tempfile.TemporaryDirectory(prefix='nimbo-proxy-') as directory, contextlib.ExitStack() as stack:
        context, ca = certificates(pathlib.Path(directory))
        http = stack.enter_context(running(origin()))
        https = stack.enter_context(running(origin(context)))
        ports = (http.server_port, https.server_port)
        relays, configs = {}, []
        for mode in ('http', 'http-auth', 'https-auth', 'socks5h', 'socks5h-auth'):
            credentials = (secrets.token_hex(8) + '@', secrets.token_hex(12) + ':/% café') if 'auth' in mode else None
            relay = stack.enter_context(running(proxy(mode, ports, credentials, context if mode.startswith('https') else None)))
            relays[mode] = relay
            authority = '127.0.0.1:' + str(relay.server_address[1])
            if credentials:
                authority = ':'.join(urllib.parse.quote(value, safe='') for value in credentials) + '@' + authority
            configs.append({'mode': mode, 'url': mode.split('-')[0] + '://' + authority})
        print(json.dumps({'ca': ca.read_text(), 'http_port': http.server_port,
                          'https_port': https.server_port, 'proxies': configs}), flush=True)
        for line in sys.stdin:
            if line.strip() != 'stats':
                break
            requests = http.requests + https.requests
            print(json.dumps({'requests': len(requests),
                              'paths': dict(collections.Counter(path for path, *_rest in requests)),
                              'credential_leaks': sum(auth is not None for _path, _method, _body, _cookie, auth in requests),
                              'bad_posts': sum(method != 'POST' or body != b'payload' for path, method, body, _cookie, _auth in requests if path == '/data'),
                              'missing_cookies': sum(cookie != 'transport=retained' for path, _method, _body, cookie, _auth in requests if path in ('/page', '/style.css', '/boot.js', '/app.mjs', '/dep.mjs', '/data')),
                              'proxy_connections': {mode: len(relay.targets) for mode, relay in relays.items()}}), flush=True)


if __name__ == '__main__':
    if sys.argv[1] == '--serve':
        serve()
    else:
        main(sys.argv[1])
