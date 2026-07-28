/**
 * Synapse design system.
 *
 * Import controls from here rather than styling them per call site — the CSS
 * lives in `src/styles/ds.css` and every token comes from that one block.
 */
export { default as Button, LinkButton } from './Button';
export type { ButtonVariant, ButtonSize } from './Button';

export { default as Panel, PanelHeader, PanelBody, PanelFooter } from './Panel';

export { default as Field, Input, Select, Textarea, Range, Readout, SliderField } from './Field';

export { Badge, Callout, Stat, StatGrid } from './Feedback';
export type { Tone } from './Feedback';

export { Segmented, Switch, Toolbar, ToolbarSpacer, ActionBar } from './Controls';
export type { SegmentedOption } from './Controls';
