-- A link page's layout (spec 0061, AC-6103, 31 Oct 2026; lane R4). The spec reads "the page's layout (spec 0060)",
-- but neither spec stored one, so the look gains one optional key: `layout`, `list` (what every page drew before)
-- or `grid`. Absent is `list`, so no stored look changes and no default moves. The check keeps every rule it had and
-- lets this one key through, with its two words only. Written, as the rest of the look, through
-- crm_save_profile_theme, which stores the look whole and is unchanged.
alter table auth.public_profiles drop constraint public_profiles_theme;
--> statement-breakpoint
alter table auth.public_profiles add constraint public_profiles_theme check (
  theme is null or (
    jsonb_typeof(theme) = 'object'
    and theme - 'ground' - 'hue' - 'mode' - 'shape' - 'fill' - 'font' - 'gradient' - 'pattern' - 'header' - 'avatar'
      - 'layout' = '{}'::jsonb
    and coalesce(theme ->> 'ground', '') in ('plain', 'paper', 'tint', 'ink', 'gradient', 'pattern', 'image')
    and coalesce(theme ->> 'hue', '') in
      ('gray', 'red', 'orange', 'yellow', 'lime', 'green', 'sky', 'blue', 'purple')
    and coalesce(theme ->> 'mode', '') in ('light', 'dark', 'system')
    and coalesce(theme ->> 'shape', '') in ('soft', 'pill', 'square')
    and coalesce(theme ->> 'fill', '') in ('plain', 'soft', 'outline', 'solid')
    and coalesce(theme ->> 'font', '') in
      ('sans', 'mono', 'grotesk', 'editorial', 'classic', 'friendly', 'geometric', 'display')
    and coalesce(theme ->> 'gradient', '') in ('dawn', 'dusk', 'mint', 'ocean', 'peach', 'grape', 'sand', 'graphite')
    and coalesce(theme ->> 'pattern', '') in ('dots', 'grid', 'lines', 'waves')
    and coalesce(theme ->> 'header', '') in ('centred', 'cover', 'left')
    and coalesce(theme ->> 'avatar', '') in ('circle', 'rounded', 'none')
    and coalesce(theme ->> 'layout', 'list') in ('list', 'grid')
  )
);
