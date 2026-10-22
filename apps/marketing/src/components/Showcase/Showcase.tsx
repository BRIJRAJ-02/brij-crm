import { Icon, TabPanel, Tabs } from '@crm/ui';
import { useState } from 'react';
import { SHOWCASE, type ShowcaseArea } from '../../showcase.ts';
import styles from './Showcase.module.css';

/** The app in a window: the bar with its address, then the area's screen. */
function Window({ area, isFirst }: { readonly area: ShowcaseArea; readonly isFirst: boolean }) {
  return (
    <figure className={styles.window}>
      <div className={styles.bar} aria-hidden="true">
        <span className={styles.lights}>
          <span className={styles.light} data-tone="red" />
          <span className={styles.light} data-tone="yellow" />
          <span className={styles.light} data-tone="green" />
        </span>
        <span className={styles.address}>
          <Icon name="lock" size="xs" />
          {area.address}
        </span>
      </div>
      <div className={styles.viewport}>
        <img
          className={styles.shot}
          src={`/shots/${area.id}.webp`}
          alt={area.alt}
          width={3840}
          height={2400}
          decoding="async"
          loading={isFirst ? 'eager' : 'lazy'}
          {...(isFirst ? { fetchPriority: 'high' as const } : {})}
        />
      </div>
    </figure>
  );
}

/**
 * The product's four areas as the library's feature tabs, the chosen one's screen in a window under them, whole:
 * the window takes the width or the height it has, whichever runs out first. The first screen is in the page from
 * the start; the rest load as they are picked.
 */
export function Showcase() {
  const [selected, setSelected] = useState<string>(SHOWCASE[0]?.id ?? 'crm');
  return (
    <div className={styles.root}>
      <Tabs
        label="What Timefix does"
        variant="feature"
        tabs={SHOWCASE.map((area) => ({
          id: area.id,
          label: area.label,
          description: area.description,
          icon: area.icon,
          hue: area.hue,
        }))}
        selectedKey={selected}
        onSelectionChange={setSelected}
      >
        {SHOWCASE.map((area, index) => (
          <TabPanel id={area.id} key={area.id} variant="fill">
            <div className={styles.fit}>
              <Window area={area} isFirst={index === 0} />
            </div>
          </TabPanel>
        ))}
      </Tabs>
    </div>
  );
}
