// The app's look (spec 0072, decision 16). A part that guests also draw (a booking page, a hosted form) keeps its
// shipped look in its own CSS module, so a guest page's stylesheet stays what it was; the Timefix prototype's look for
// the app sits beside it in `<Part>.app.css`, under the class names the part's module already has, in the later
// `utilities.app-look` layer and only under `<html data-scale="app">`. This file loads every such look. The app's
// layouts (AppShell, AuthLayout, PreviewLayout) and the stories import it; nothing a guest page loads does. It goes
// when the guest pages take the prototype's look in their own port phases (6 to 8) and each part has one look again.
import './atoms/Avatar/Avatar.app.css';
import './atoms/Badge/Badge.app.css';
import './atoms/Button/Button.app.css';
import './atoms/Checkbox/Checkbox.app.css';
import './atoms/DragHandle/DragHandle.app.css';
import './atoms/FieldError/FieldError.app.css';
import './atoms/FieldLabel/FieldLabel.app.css';
import './atoms/Icon/Icon.app.css';
import './atoms/Kbd/Kbd.app.css';
import './atoms/Link/Link.app.css';
import './atoms/Radio/Radio.app.css';
import './atoms/Switch/Switch.app.css';
import './atoms/Tooltip/Tooltip.app.css';
import './molecules/Callout/Callout.app.css';
import './molecules/Card/Card.app.css';
import './molecules/ChoiceChips/ChoiceChips.app.css';
import './molecules/Disclosure/Disclosure.app.css';
import './molecules/Field/Field.app.css';
import './molecules/FieldGroup/FieldGroup.app.css';
import './molecules/Menu/Menu.app.css';
import './molecules/Popover/Popover.app.css';
import './molecules/SegmentedControl/SegmentedControl.app.css';
import './molecules/Select/Select.app.css';
import './molecules/SocialLinks/SocialLinks.app.css';
import './molecules/Tabs/Tabs.app.css';
