-- Four templates for every public page (spec 0068, AC-6801 to AC-6805; 4 November 2026). Numbered 0170: 0166 to 0169
-- are claimed by other branches.
--
-- 1. The brand kit holds the workspace's template (AC-6804), Classic until an owner or admin picks another. A closed
--    set of four words, so nothing typed reaches the page.
-- 2. A link page's look gains two optional keys: `template` (one of the four; absent follows the workspace) and
--    `moved` (true only, the one time note of AC-6805). The check keeps every rule it had and lets these two through.
-- 3. Every existing link page moves to the nearest template once (AC-6805), by which of the old presets its look
--    is, key for key with the hue left out (`nearestTemplate` in `@crm/contracts`, held to this table by
--    `page-theme.test.ts`): plain, paper, quiet, ocean, mint → Classic; editorial, dawn, gallery → Studio; ink,
--    bold → Night; studio and any remaining → Split with a cover photo, else Classic. The old keys stay stored and
--    unused, and the page carries `moved` so its editor says so once.
set local lock_timeout = '5s';
--> statement-breakpoint
alter table workspace_brands add column template text not null default 'classic';
--> statement-breakpoint
alter table workspace_brands add constraint workspace_brands_template
  check (template in ('classic', 'studio', 'night', 'split'));
--> statement-breakpoint
alter table auth.public_profiles drop constraint public_profiles_theme;
--> statement-breakpoint
alter table auth.public_profiles add constraint public_profiles_theme check (
  theme is null or (
    jsonb_typeof(theme) = 'object'
    and theme - 'ground' - 'hue' - 'mode' - 'shape' - 'fill' - 'font' - 'gradient' - 'pattern' - 'header' - 'avatar'
      - 'layout' - 'template' - 'moved' = '{}'::jsonb
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
    and coalesce(theme ->> 'template', 'classic') in ('classic', 'studio', 'night', 'split')
    and (not theme ? 'moved' or theme -> 'moved' = 'true'::jsonb)
  )
);
--> statement-breakpoint
with presets (id, ground, mode, shape, fill, font, gradient, pattern, header, avatar) as (
  values
    ('plain', 'plain', 'light', 'soft', 'plain', 'sans', 'dawn', 'dots', 'centred', 'circle'),
    ('paper', 'paper', 'light', 'soft', 'plain', 'sans', 'dawn', 'dots', 'centred', 'circle'),
    ('bold', 'tint', 'light', 'pill', 'solid', 'sans', 'dawn', 'dots', 'centred', 'circle'),
    ('ink', 'ink', 'dark', 'soft', 'outline', 'sans', 'dawn', 'dots', 'centred', 'circle'),
    ('quiet', 'paper', 'light', 'square', 'plain', 'mono', 'dawn', 'dots', 'centred', 'circle'),
    ('dawn', 'gradient', 'light', 'pill', 'plain', 'friendly', 'dawn', 'dots', 'centred', 'circle'),
    ('ocean', 'gradient', 'light', 'soft', 'solid', 'geometric', 'ocean', 'dots', 'centred', 'circle'),
    ('mint', 'gradient', 'light', 'soft', 'outline', 'grotesk', 'mint', 'dots', 'centred', 'circle'),
    ('studio', 'pattern', 'light', 'square', 'outline', 'grotesk', 'dawn', 'grid', 'centred', 'circle'),
    ('editorial', 'paper', 'light', 'soft', 'plain', 'editorial', 'dawn', 'dots', 'left', 'circle'),
    ('night', 'ink', 'dark', 'soft', 'outline', 'display', 'dawn', 'dots', 'centred', 'circle'),
    ('peach', 'gradient', 'light', 'pill', 'solid', 'friendly', 'peach', 'dots', 'centred', 'circle'),
    ('graphite', 'gradient', 'dark', 'soft', 'plain', 'mono', 'graphite', 'dots', 'centred', 'circle'),
    ('gallery', 'image', 'light', 'soft', 'plain', 'classic', 'dawn', 'dots', 'cover', 'rounded')
),
mapped as (
  select p.user_id, p.workspace_id,
    case (
      select s.id from presets s
      where s.ground = p.theme ->> 'ground' and s.mode = p.theme ->> 'mode' and s.shape = p.theme ->> 'shape'
        and s.fill = p.theme ->> 'fill' and s.font = p.theme ->> 'font' and s.gradient = p.theme ->> 'gradient'
        and s.pattern = p.theme ->> 'pattern' and s.header = p.theme ->> 'header' and s.avatar = p.theme ->> 'avatar'
      limit 1
    )
      when 'plain' then 'classic' when 'paper' then 'classic' when 'quiet' then 'classic'
      when 'ocean' then 'classic' when 'mint' then 'classic'
      when 'editorial' then 'studio' when 'dawn' then 'studio' when 'gallery' then 'studio'
      when 'ink' then 'night' when 'bold' then 'night'
      else case when p.cover_path is not null then 'split' else 'classic' end
    end as template
  from auth.public_profiles p
  where p.theme is not null and not p.theme ? 'template'
)
update auth.public_profiles p
set theme = p.theme || jsonb_build_object('template', m.template, 'moved', true)
from mapped m
where p.user_id = m.user_id and p.workspace_id = m.workspace_id;
