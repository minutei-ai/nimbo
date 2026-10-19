use rustls::{ClientConfig, ClientConnection, RootCertStore};
use rustls_pki_types::{CertificateDer, ServerName, pem::PemObject};
use std::{
    fmt,
    io::{Cursor, ErrorKind, Read, Write},
    sync::Arc,
};
use wasm_bindgen::prelude::*;

/// Authenticated TLS over a host-owned byte stream, independent of its TCP peer name.
#[wasm_bindgen]
pub struct WasmTlsClient {
    connection: ClientConnection,
    peer_closed: bool,
}

impl fmt::Debug for WasmTlsClient {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("WasmTlsClient")
            .finish_non_exhaustive()
    }
}

#[wasm_bindgen]
impl WasmTlsClient {
    /// Verifies the target hostname and certificate chain against Mozilla roots and optional PEM CAs.
    ///
    /// # Errors
    /// Rejects malformed names, trust anchors and TLS configuration.
    #[wasm_bindgen(constructor)]
    pub fn new(hostname: &str, certificates: Option<String>) -> Result<Self, String> {
        let mut roots: RootCertStore = webpki_roots::TLS_SERVER_ROOTS.iter().cloned().collect();
        if let Some(pem) = certificates {
            if pem.len() > 1_048_576 {
                return Err("TLS certificate configuration limit".into());
            }
            let mut found = false;
            for certificate in CertificateDer::pem_slice_iter(pem.as_bytes()) {
                roots
                    .add(certificate.map_err(|error| error.to_string())?)
                    .map_err(|error| error.to_string())?;
                found = true;
            }
            if !found {
                return Err("TLS certificate configuration is empty".into());
            }
        }
        let config =
            ClientConfig::builder_with_provider(Arc::new(rustls::crypto::ring::default_provider()))
                .with_safe_default_protocol_versions()
                .map_err(|error| error.to_string())?
                .with_root_certificates(roots)
                .with_no_client_auth();
        let name = ServerName::try_from(hostname.to_owned()).map_err(|error| error.to_string())?;
        let mut connection =
            ClientConnection::new(Arc::new(config), name).map_err(|error| error.to_string())?;
        connection.set_buffer_limit(Some(65_536));
        Ok(Self {
            connection,
            peer_closed: false,
        })
    }

    /// Reports whether the TLS handshake is still in progress.
    #[must_use]
    pub fn handshaking(&self) -> bool {
        self.connection.is_handshaking()
    }

    /// Reports an authenticated close notification from the peer.
    #[must_use]
    pub fn peer_closed(&self) -> bool {
        self.peer_closed
    }

    /// Consumes encrypted bytes and validates the resulting TLS messages.
    ///
    /// # Errors
    /// Rejects invalid certificates, names, protocol messages and encrypted records.
    pub fn receive(&mut self, bytes: &[u8]) -> Result<usize, String> {
        if bytes.len() > 65_536 {
            return Err("TLS record input limit".into());
        }
        let consumed = self
            .connection
            .read_tls(&mut Cursor::new(bytes))
            .map_err(|error| error.to_string())?;
        self.peer_closed = self
            .connection
            .process_new_packets()
            .map_err(|error| error.to_string())?
            .peer_has_closed();
        Ok(consumed)
    }

    /// Drains encrypted handshake, application or alert records for the host to transmit.
    ///
    /// # Errors
    /// Propagates a failure to encode the pending TLS records.
    pub fn outgoing(&mut self) -> Result<Vec<u8>, String> {
        let mut bytes = Vec::new();
        self.connection
            .write_tls(&mut bytes)
            .map_err(|error| error.to_string())?;
        Ok(bytes)
    }

    /// Queues one bounded application fragment after certificate validation.
    ///
    /// # Errors
    /// Rejects pre-handshake writes, oversized fragments and TLS backpressure.
    pub fn write(&mut self, bytes: &[u8]) -> Result<(), String> {
        if self.connection.is_handshaking() {
            return Err("TLS handshake is incomplete".into());
        }
        if bytes.len() > 16_384 {
            return Err("TLS plaintext fragment limit".into());
        }
        self.connection
            .writer()
            .write_all(bytes)
            .map_err(|error| error.to_string())
    }

    /// Reads one bounded fragment of authenticated application bytes.
    ///
    /// # Errors
    /// Rejects truncated TLS streams and protocol failures.
    pub fn read(&mut self) -> Result<Vec<u8>, String> {
        let mut bytes = vec![0; 16_384];
        match self.connection.reader().read(&mut bytes) {
            Ok(length) => {
                bytes.truncate(length);
                Ok(bytes)
            }
            Err(error) if error.kind() == ErrorKind::WouldBlock => Ok(Vec::new()),
            Err(error) => Err(error.to_string()),
        }
    }
}
