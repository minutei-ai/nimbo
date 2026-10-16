//! CSS containing-block policy over native Taffy styles.
use taffy::{
    Overflow, Point,
    prelude::*,
    style::{
        BoxGenerationMode, Contain, ContainingBlockClaims, CoreStyle, Direction, GridContainerStyle,
    },
};

pub(super) struct ContainerStyle<'a> {
    pub(super) style: &'a Style,
    pub(super) transformed: bool,
}

impl CoreStyle for ContainerStyle<'_> {
    type CustomIdent = String;
    fn is_containing_block(&self) -> ContainingBlockClaims {
        ContainingBlockClaims {
            absolute: self.transformed || self.style.position.is_positioned(),
            fixed: self.transformed,
        }
    }
    fn box_generation_mode(&self) -> BoxGenerationMode {
        CoreStyle::box_generation_mode(self.style)
    }
    fn is_block(&self) -> bool {
        CoreStyle::is_block(self.style)
    }
    fn is_compressible_replaced(&self) -> bool {
        CoreStyle::is_compressible_replaced(self.style)
    }
    fn is_replaced(&self) -> bool {
        CoreStyle::is_replaced(self.style)
    }
    fn box_sizing(&self) -> BoxSizing {
        CoreStyle::box_sizing(self.style)
    }
    fn direction(&self) -> Direction {
        CoreStyle::direction(self.style)
    }
    fn overflow(&self) -> Point<Overflow> {
        CoreStyle::overflow(self.style)
    }
    fn scrollbar_width(&self) -> f32 {
        CoreStyle::scrollbar_width(self.style)
    }
    fn position(&self) -> Position {
        CoreStyle::position(self.style)
    }
    fn inset(&self) -> Rect<LengthPercentageAuto> {
        CoreStyle::inset(self.style)
    }
    fn size(&self) -> Size<Dimension> {
        CoreStyle::size(self.style)
    }
    fn min_size(&self) -> Size<LengthPercentageAuto> {
        CoreStyle::min_size(self.style)
    }
    fn max_size(&self) -> Size<LengthPercentageAuto> {
        CoreStyle::max_size(self.style)
    }
    fn aspect_ratio(&self) -> Option<f32> {
        CoreStyle::aspect_ratio(self.style)
    }
    fn margin(&self) -> Rect<LengthPercentageAuto> {
        CoreStyle::margin(self.style)
    }
    fn padding(&self) -> Rect<LengthPercentage> {
        CoreStyle::padding(self.style)
    }
    fn border(&self) -> Rect<LengthPercentage> {
        CoreStyle::border(self.style)
    }
    fn contain(&self) -> Contain {
        CoreStyle::contain(self.style)
    }
}

impl GridContainerStyle for ContainerStyle<'_> {
    type Repetition<'a>
        = <Style as GridContainerStyle>::Repetition<'a>
    where
        Self: 'a;
    type TemplateTrackList<'a>
        = <Style as GridContainerStyle>::TemplateTrackList<'a>
    where
        Self: 'a;
    type AutoTrackList<'a>
        = <Style as GridContainerStyle>::AutoTrackList<'a>
    where
        Self: 'a;
    type TemplateLineNames<'a>
        = <Style as GridContainerStyle>::TemplateLineNames<'a>
    where
        Self: 'a;
    type GridTemplateAreas<'a>
        = <Style as GridContainerStyle>::GridTemplateAreas<'a>
    where
        Self: 'a;
    fn grid_template_rows(&self) -> Option<Self::TemplateTrackList<'_>> {
        GridContainerStyle::grid_template_rows(self.style)
    }
    fn grid_template_columns(&self) -> Option<Self::TemplateTrackList<'_>> {
        GridContainerStyle::grid_template_columns(self.style)
    }
    fn grid_auto_rows(&self) -> Self::AutoTrackList<'_> {
        GridContainerStyle::grid_auto_rows(self.style)
    }
    fn grid_auto_columns(&self) -> Self::AutoTrackList<'_> {
        GridContainerStyle::grid_auto_columns(self.style)
    }
    fn grid_auto_flow(&self) -> GridAutoFlow {
        GridContainerStyle::grid_auto_flow(self.style)
    }
    fn gap(&self) -> Size<LengthPercentage> {
        GridContainerStyle::gap(self.style)
    }
    fn align_content(&self) -> AlignContent {
        GridContainerStyle::align_content(self.style)
    }
    fn justify_content(&self) -> JustifyContent {
        GridContainerStyle::justify_content(self.style)
    }
    fn align_items(&self) -> AlignItems {
        GridContainerStyle::align_items(self.style)
    }
    fn justify_items(&self) -> AlignItems {
        GridContainerStyle::justify_items(self.style)
    }
    fn grid_template_areas(&self) -> Option<Self::GridTemplateAreas<'_>> {
        GridContainerStyle::grid_template_areas(self.style)
    }
    fn grid_template_area_row_count(&self) -> u16 {
        GridContainerStyle::grid_template_area_row_count(self.style)
    }
    fn grid_template_area_column_count(&self) -> u16 {
        GridContainerStyle::grid_template_area_column_count(self.style)
    }
    fn grid_template_column_names(&self) -> Option<Self::TemplateLineNames<'_>> {
        GridContainerStyle::grid_template_column_names(self.style)
    }
    fn grid_template_row_names(&self) -> Option<Self::TemplateLineNames<'_>> {
        GridContainerStyle::grid_template_row_names(self.style)
    }
}
