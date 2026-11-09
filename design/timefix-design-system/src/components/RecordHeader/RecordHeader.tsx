import { Button as AriaButton, Input, TextField, ToggleButton, type Key } from 'react-aria-components';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Star, Mail, MoreHorizontal, ChevronUp, ChevronDown, Sparkles } from 'lucide-react';
import { Avatar } from '../Avatar/Avatar.tsx';
import { Button, IconButton } from '../Button/Button.tsx';
import { Tag, type Hue } from '../Tag/Tag.tsx';
import { Tooltip } from '../Tooltip/Tooltip.tsx';
import { NumberRoll } from '../Motion/Motion.tsx';
import { AITag } from '../AIAssist/AIAssist.tsx';
import { AttributeField, type Attribute, type AttributeValue } from '../AttributeField/AttributeField.tsx';
import { MenuTrigger, Menu } from '../Menu/Menu.tsx';
import './RecordHeader.css';

/** A tag on a record's header. `ai` marks one AI enrichment found. */
export interface RecordHeaderTag { readonly label: string; readonly hue?: Hue; readonly ai?: boolean }

/** Props for RecordHeader. */
export interface RecordHeaderProps {
  readonly name: string;
  /** People get a round avatar, companies and deals a rounded square. */
  readonly kind: 'person' | 'company' | 'deal';
  readonly src?: string;
  /** The grey line under the name ("Head of Ops at Acme Corp · London"). */
  readonly sub?: ReactNode;
  readonly tags?: ReadonlyArray<RecordHeaderTag>;
  /** Saves a renamed record. Omit to make the name read only. */
  readonly onRename?: (name: string) => void;
  readonly isStarred?: boolean;
  readonly onStarChange?: (starred: boolean) => void;
  readonly onAskAI?: () => void;
  /** Whether the Ask AI panel is open, so its button stays pressed. */
  readonly isAskOpen?: boolean;
  readonly onEmail?: () => void;
  readonly onMore?: () => void;
  /** The "…" menu's `MenuItem`s (Copy link, Merge, Delete). Given, the "…" opens the shared Menu and `onMoreAction` gets the picked id. */
  readonly moreActions?: ReactNode;
  readonly onMoreAction?: (key: Key) => void;
  /** The stage (a status attribute) and its value, edited with the status field. */
  readonly stage?: { readonly attribute: Attribute; readonly value: AttributeValue; readonly onChange: (v: AttributeValue) => void };
  /** Where this record sits in the list it was opened from ("7 of 70"). */
  readonly position?: { readonly index: number; readonly total: number; readonly onPrevious: () => void; readonly onNext: () => void };
}

function InlineName({ name, onRename }: { readonly name: string; readonly onRename?: (name: string) => void }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(name);
  const btn = useRef<HTMLButtonElement>(null);
  const back = useRef(false);
  useEffect(() => { if (!editing && back.current) { back.current = false; btn.current?.focus(); } }, [editing]);
  if (!onRename) return <h2 className="tf-rh__name tf-rh__name--static">{name}</h2>;
  const end = (save: boolean, refocus: boolean) => { if (save && draft.trim() && draft.trim() !== name) onRename(draft.trim()); back.current = refocus; setEditing(false); };
  return editing ? (
    <TextField aria-label="Name" value={draft} onChange={setDraft} autoFocus className="tf-rh__name-edit" onBlur={() => end(true, false)}>
      <Input className="tf-rh__name-input" autoComplete="off" onKeyDown={(e) => { if (e.key === 'Enter') end(true, true); if (e.key === 'Escape') { setDraft(name); end(false, true); } }} />
    </TextField>
  ) : (
    <h2 className="tf-rh__name"><AriaButton ref={btn} className="tf-rh__name-btn" onPress={() => { setDraft(name); setEditing(true); }} aria-label={`${name}. Rename`}>{name}</AriaButton></h2>
  );
}

/** The top of a record page: who or what it is, its tags, the actions on it, its stage, and where it sits in the list. */
export function RecordHeader({ name, kind, src, sub, tags = [], onRename, isStarred = false, onStarChange, onAskAI, isAskOpen, onEmail, onMore, moreActions, onMoreAction, stage, position }: RecordHeaderProps) {
  return (
    <header className="tf-rh">
      <div className="tf-rh__top">
        <Avatar name={name} src={src} size={44} shape={kind === 'person' ? 'round' : 'square'} />
        <div className="tf-rh__id">
          <InlineName name={name} onRename={onRename} />
          {sub !== undefined && <p className="tf-rh__sub">{sub}</p>}
        </div>
        {position && (
          <div className="tf-rh__pos" role="group" aria-label="Records in this list">
            <span className="tf-rh__count" aria-live="polite"><NumberRoll value={position.index} /> of {position.total.toLocaleString('en-US')}</span>
            <Tooltip label="Previous record" shortcut="K"><IconButton size="sm" label="Previous record" isDisabled={position.index <= 1} onPress={position.onPrevious}><ChevronUp size={14} strokeWidth={1.75} /></IconButton></Tooltip>
            <Tooltip label="Next record" shortcut="J"><IconButton size="sm" label="Next record" isDisabled={position.index >= position.total} onPress={position.onNext}><ChevronDown size={14} strokeWidth={1.75} /></IconButton></Tooltip>
          </div>
        )}
      </div>

      {tags.length > 0 && (
        <ul className="tf-rh__tags" aria-label="Tags">
          {tags.map((t) => <li key={t.label}>{t.ai ? <AITag>{t.label}</AITag> : <Tag size="sm" hue={t.hue}>{t.label}</Tag>}</li>)}
        </ul>
      )}

      <div className="tf-rh__bar">
        {stage && <div className="tf-rh__stage"><span className="tf-rh__stage-label">{stage.attribute.name}</span><AttributeField attribute={stage.attribute} value={stage.value} onChange={stage.onChange} /></div>}
        <div className="tf-rh__actions">
          {onAskAI && <Button size="sm" variant="secondary" aria-expanded={isAskOpen} onPress={onAskAI} icon={<span className="tf-rh__ai"><Sparkles size={14} strokeWidth={1.75} /></span>}>Ask AI</Button>}
          {onStarChange && (
            <Tooltip label={isStarred ? 'Remove from favourites' : 'Add to favourites'}>
              <ToggleButton isSelected={isStarred} onChange={onStarChange} aria-label="Favourite" className="tf-rh__star">
                <span className="tf-rh__swap" data-state={isStarred ? 'b' : 'a'} aria-hidden="true">
                  <Star className="tf-rh__swap-a" size={14} strokeWidth={1.75} />
                  <Star className="tf-rh__swap-b" size={14} strokeWidth={1.75} />
                </span>
              </ToggleButton>
            </Tooltip>
          )}
          {onEmail && <Tooltip label="Send email" shortcut="E"><IconButton label="Send email" variant="secondary" size="sm" onPress={onEmail}><Mail size={14} strokeWidth={1.75} /></IconButton></Tooltip>}
          {moreActions !== undefined ? (
            <MenuTrigger>
              <Tooltip label="More actions"><IconButton label="More actions" variant="ghost" size="sm"><MoreHorizontal size={14} strokeWidth={1.75} /></IconButton></Tooltip>
              <Menu aria-label={`Actions for ${name}`} placement="bottom end" onAction={onMoreAction}>{moreActions}</Menu>
            </MenuTrigger>
          ) : onMore && <Tooltip label="More actions"><IconButton label="More actions" variant="ghost" size="sm" onPress={onMore}><MoreHorizontal size={14} strokeWidth={1.75} /></IconButton></Tooltip>}
        </div>
      </div>
    </header>
  );
}
