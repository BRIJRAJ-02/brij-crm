// The component library's public surface. Screens import from here only.
export {
  Avatar,
  AvatarStack,
  type AvatarProps,
  type AvatarSize,
  type AvatarStackPerson,
  type AvatarStackProps,
} from './atoms/Avatar/Avatar.tsx';
export { Badge, type BadgeProps, type BadgeTone } from './atoms/Badge/Badge.tsx';
export {
  Button,
  SplitButton,
  ToggleButton,
  type ButtonProps,
  type ButtonSize,
  type ButtonVariant,
  type SplitButtonProps,
  type ToggleButtonProps,
} from './atoms/Button/Button.tsx';
export { CopyButton, type CopyButtonProps } from './atoms/Button/CopyButton.tsx';
export { Checkbox, type CheckboxProps } from './atoms/Checkbox/Checkbox.tsx';
export { Code, type CodeProps } from './atoms/Code/Code.tsx';
export { Currency, type CurrencyProps } from './atoms/Currency/Currency.tsx';
export { FileIcon, fileIconName, type FileIconProps } from './atoms/FileIcon/FileIcon.tsx';
export { Icon, type IconProps, type IconSize, type IconTone } from './atoms/Icon/Icon.tsx';
export type { IconName } from './atoms/Icon/icons.ts';
export { Kbd, type KbdProps, type KbdTone } from './atoms/Kbd/Kbd.tsx';
export type { KeyboardPlatform } from './atoms/Kbd/shortcuts.ts';
export { Link, type LinkProps } from './atoms/Link/Link.tsx';
export { LinkChip, type LinkChipProps } from './atoms/LinkChip/LinkChip.tsx';
export { Mention, type MentionProps } from './atoms/Mention/Mention.tsx';
export { Meter, type MeterProps } from './atoms/Meter/Meter.tsx';
export { Path, type PathProps } from './atoms/Path/Path.tsx';
export { ProgressBar, type ProgressBarProps } from './atoms/ProgressBar/ProgressBar.tsx';
export { Radio, RadioGroup, type RadioGroupProps, type RadioProps } from './atoms/Radio/Radio.tsx';
export { Rating, type RatingProps } from './atoms/Rating/Rating.tsx';
export { RecordChip, type RecordChipProps } from './atoms/RecordChip/RecordChip.tsx';
export { RelativeTime, type RelativeTimeProps } from './atoms/RelativeTime/RelativeTime.tsx';
export { RemoteCursor, type RemoteCursorProps } from './atoms/RemoteCursor/RemoteCursor.tsx';
export { Separator, type SeparatorProps } from './atoms/Separator/Separator.tsx';
export { Skeleton, type SkeletonProps, type SkeletonShape, type SkeletonWidth } from './atoms/Skeleton/Skeleton.tsx';
export { Spinner, type SpinnerProps } from './atoms/Spinner/Spinner.tsx';
export { StatusDot, type StatusDotProps } from './atoms/StatusDot/StatusDot.tsx';
export { Switch, type SwitchProps } from './atoms/Switch/Switch.tsx';
export { Tag, TagList, type TagItem, type TagListProps, type TagProps } from './atoms/Tag/Tag.tsx';
export { Tooltip, type TooltipPlacement, type TooltipProps } from './atoms/Tooltip/Tooltip.tsx';
export { TruncatedText, type TruncatedTextProps } from './atoms/TruncatedText/TruncatedText.tsx';
export { Variable, type VariableProps } from './atoms/Variable/Variable.tsx';
export { VisuallyHidden, type VisuallyHiddenProps } from './atoms/VisuallyHidden/VisuallyHidden.tsx';
export { AttributeDisplay, type AttributeDisplayProps } from './fields/AttributeDisplay.tsx';
export { AttributeEditor, type AttributeEditorProps } from './fields/AttributeEditor.tsx';
export { createPhoneParser, loadPhoneLibrary } from './fields/Phone/phone-library.ts';
export { columnWidthOf, FIELD_TYPES, fieldTypeOf, isSystemOnly } from './fields/registry.ts';
export type {
  AttributeTypeDef,
  CellChange,
  ColumnWidth,
  DisplayProps,
  EditorProps,
  FieldAttribute,
  FieldDisplay,
  FieldValue,
  OperandKind,
  OperatorDef,
  PhoneParser,
  Surface,
  TextContext,
  TextRefusal,
} from './fields/types.ts';
export { isRefusal } from './fields/values.ts';
export { HUES, type Hue } from './hue.ts';
export { arraySource, type ListRange, type ListSource } from './lib/list-source.ts';
export { safeHref } from './lib/safe-href.ts';
export { safeImageSrc } from './lib/safe-image-src.ts';
export { Breadcrumbs, type BreadcrumbsProps, type Crumb } from './molecules/Breadcrumbs/Breadcrumbs.tsx';
export { Callout, type CalloutProps, type CalloutTone } from './molecules/Callout/Callout.tsx';
export { Card, type CardProps } from './molecules/Card/Card.tsx';
export { CodeInput, type CodeInputProps } from './molecules/CodeInput/CodeInput.tsx';
export {
  DatePicker,
  DateRangePicker,
  dayIn,
  quickPicks,
  type DatePickerProps,
  type DateRange,
  type DateRangePickerProps,
} from './molecules/DatePicker/DatePicker.tsx';
export {
  DescriptionList,
  type DescriptionItem,
  type DescriptionListProps,
} from './molecules/DescriptionList/DescriptionList.tsx';
export {
  Disclosure,
  DisclosureGroup,
  type DisclosureGroupProps,
  type DisclosureProps,
} from './molecules/Disclosure/Disclosure.tsx';
export { EmptyState, type EmptyStateProps, type EmptyStateTone } from './molecules/EmptyState/EmptyState.tsx';
export { Field, type FieldProps, type FieldSize } from './molecules/Field/Field.tsx';
export { FileDrop, type FileDropProps } from './molecules/FileDrop/FileDrop.tsx';
export { FileItem, formatFileSize, type FileItemProps } from './molecules/FileItem/FileItem.tsx';
export { FilterChip, type FilterChipProps } from './molecules/FilterChip/FilterChip.tsx';
export { HuePicker, type HuePickerProps } from './molecules/HuePicker/HuePicker.tsx';
export { IconPicker, type IconPickerProps } from './molecules/IconPicker/IconPicker.tsx';
export {
  ContextMenu,
  Menu,
  MenuItem,
  MenuSection,
  MenuSeparator,
  MenuTrigger,
  SubmenuTrigger,
  type ContextMenuProps,
  type MenuItemProps,
  type MenuKey,
  type MenuProps,
  type MenuSearch,
  type MenuSectionProps,
  type MenuTriggerProps,
  type SubmenuTriggerProps,
} from './molecules/Menu/Menu.tsx';
export {
  Modal,
  ModalTrigger,
  type ModalProps,
  type ModalTriggerProps,
  type ModalVariant,
} from './molecules/Modal/Modal.tsx';
export { Panel, type PanelProps, type PanelVariant, type PanelWidth } from './molecules/Panel/Panel.tsx';
export { Popover, type PopoverPlacement, type PopoverProps, type PopoverWidth } from './molecules/Popover/Popover.tsx';
export {
  SegmentedControl,
  ThemeSwitch,
  type Segment,
  type SegmentedControlProps,
  type ThemeSwitchProps,
} from './molecules/SegmentedControl/SegmentedControl.tsx';
export { Select, type SelectItem, type SelectOptionStyle, type SelectProps } from './molecules/Select/Select.tsx';
export { Steps, type Step, type StepsProps } from './molecules/Steps/Steps.tsx';
export { Table, type TableColumn, type TableProps } from './molecules/Table/Table.tsx';
export { TabPanel, Tabs, type TabItem, type TabPanelProps, type TabsProps } from './molecules/Tabs/Tabs.tsx';
export { ActivityFeed, type ActivityEntry, type ActivityFeedProps } from './modules/ActivityFeed/ActivityFeed.tsx';
export { AppShell, AppShellContext, type AppShellProps } from './modules/AppShell/AppShell.tsx';
export {
  AttributeList,
  type AttributeEditorExtras,
  type AttributeItem,
  type AttributeListProps,
  type AttributeSection,
} from './modules/AttributeList/AttributeList.tsx';
export { BulkActionBar, type BulkActionBarProps } from './modules/BulkActionBar/BulkActionBar.tsx';
export {
  CommandPalette,
  type CommandPaletteProps,
  type PaletteItem,
} from './modules/CommandPalette/CommandPalette.tsx';
export {
  FilterBuilder,
  type FilterBuilderProps,
  type FilterEditorProps,
} from './modules/FilterBuilder/FilterBuilder.tsx';
export { completeFilters, countFilters } from './modules/FilterBuilder/filter-model.ts';
export {
  ShortcutHelp,
  type Shortcut,
  type ShortcutGroup,
  type ShortcutHelpProps,
} from './modules/ShortcutHelp/ShortcutHelp.tsx';
export {
  NavItem,
  NavSection,
  Sidebar,
  type NavItemProps,
  type NavSectionProps,
  type SidebarProps,
} from './modules/Sidebar/Sidebar.tsx';
export { RecordHeader, type RecordHeaderProps } from './modules/RecordHeader/RecordHeader.tsx';
export { RecordPanel, type RecordPanelProps, type RecordPanelTab } from './modules/RecordPanel/RecordPanel.tsx';
export { SortBuilder, type SortBuilderProps } from './modules/SortBuilder/SortBuilder.tsx';
export { TaskList, type TaskEntry, type TaskListProps } from './modules/TaskList/TaskList.tsx';
export { ViewSettings, type ViewField, type ViewSettingsProps } from './modules/ViewSettings/ViewSettings.tsx';
export {
  SortChip,
  Toolbar,
  TopBar,
  ViewBar,
  type SortChipProps,
  type ToolbarProps,
  type TopBarProps,
  type ViewBarProps,
  type ViewChoice,
} from './modules/Toolbar/Toolbar.tsx';
export { createToasts, type ToastAction, type ToastContent, type Toasts, type ToastTone } from './provider/toasts.tsx';
export { UiProvider, type FormatSettings, type UiProviderProps } from './provider/UiProvider.tsx';
export { LOADING_TIMING, useDelayedLoading, type LoadingTiming } from './provider/useDelayedLoading.ts';
