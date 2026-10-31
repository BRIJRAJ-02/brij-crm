// Media links (spec 0061, AC-6105, AC-6106): each provider's accepted and refused share links, look alike hosts and
// extra query text among them, and every address built back from the parsed provider and id alone.
import { describe, expect, it } from 'vitest';
import {
  cleanTitle,
  isMediaInfoHost,
  isMediaPosterHost,
  isMediaRef,
  MEDIA_FRAME_ORIGINS,
  mediaFrameSrc,
  mediaInfoSource,
  mediaShareUrl,
  parseMediaLink,
  readOembed,
} from './embeds.ts';

describe('parseMediaLink', () => {
  it.each([
    ['https://www.youtube.com/watch?v=dQw4w9WgXcQ', 'youtube', 'dQw4w9WgXcQ'],
    ['https://youtube.com/watch?v=dQw4w9WgXcQ&t=42s&si=abc', 'youtube', 'dQw4w9WgXcQ'],
    ['youtu.be/dQw4w9WgXcQ', 'youtube', 'dQw4w9WgXcQ'],
    ['https://m.youtube.com/shorts/dQw4w9WgXcQ', 'youtube', 'dQw4w9WgXcQ'],
    ['https://music.youtube.com/watch?v=dQw4w9WgXcQ', 'youtube', 'dQw4w9WgXcQ'],
    ['https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ', 'youtube', 'dQw4w9WgXcQ'],
    ['https://vimeo.com/76979871', 'vimeo', '76979871'],
    ['https://vimeo.com/76979871/abcdef1234', 'vimeo', '76979871:abcdef1234'],
    ['https://player.vimeo.com/video/76979871?h=abcdef1234', 'vimeo', '76979871:abcdef1234'],
    ['https://vimeo.com/channels/staffpicks/76979871', 'vimeo', '76979871'],
    ['https://open.spotify.com/track/4cOdK2wGLETKBW3PvgPWqT?si=x', 'spotify', 'track/4cOdK2wGLETKBW3PvgPWqT'],
    ['https://open.spotify.com/intl-de/album/4cOdK2wGLETKBW3PvgPWqT', 'spotify', 'album/4cOdK2wGLETKBW3PvgPWqT'],
    ['https://open.spotify.com/embed/episode/4cOdK2wGLETKBW3PvgPWqT', 'spotify', 'episode/4cOdK2wGLETKBW3PvgPWqT'],
    ['https://soundcloud.com/Artist-Name/a-track', 'soundcloud', 'artist-name/a-track'],
    ['https://soundcloud.com/artist/sets/an-album', 'soundcloud', 'artist/sets/an-album'],
    [
      'https://music.apple.com/us/album/the-album/1440818839?i=1440818840',
      'applemusic',
      'us/album/the-album/1440818839/i/1440818840',
    ],
    [
      'https://music.apple.com/gb/playlist/todays-hits/pl.f4d106fed2bd41149aaacabb233eb5eb',
      'applemusic',
      'gb/playlist/todays-hits/pl.f4d106fed2bd41149aaacabb233eb5eb',
    ],
  ])('reads %s', (link, provider, ref) => {
    expect(parseMediaLink(link)).toEqual({ ok: true, provider, ref });
  });

  it.each([
    // Look alike hosts and other services.
    'https://www.youtube.com.evil.example/watch?v=dQw4w9WgXcQ',
    'https://evilyoutube.com/watch?v=dQw4w9WgXcQ',
    'https://youtu.be.example.com/dQw4w9WgXcQ',
    'https://vimeo.com.example/76979871',
    'https://open.spotify.co/track/4cOdK2wGLETKBW3PvgPWqT',
    'https://soundcloud.com.example/artist/track',
    'https://music.apple.com.example/us/album/x/1',
    'https://example.com/watch?v=dQw4w9WgXcQ',
    // Wrong shapes.
    'https://www.youtube.com/watch?v=short',
    'https://www.youtube.com/watch?v=dQw4w9WgXcQ"><script>',
    'https://www.youtube.com/channel/UC123',
    'https://youtu.be/dQw4w9WgXcQ/extra',
    'https://vimeo.com/abc',
    'https://vimeo.com/76979871/ZZZ',
    'https://open.spotify.com/user/4cOdK2wGLETKBW3PvgPWqT',
    'https://open.spotify.com/track/../../evil',
    'https://soundcloud.com/discover/sets/x',
    'https://soundcloud.com/artist',
    'https://music.apple.com/us/artist/name/1',
    'https://music.apple.com/us/album/x/1?i=abc',
    // Schemes, credentials and ports.
    'javascript:alert(1)//youtube.com/watch?v=dQw4w9WgXcQ',
    'ftp://www.youtube.com/watch?v=dQw4w9WgXcQ',
    'https://user:pass@www.youtube.com/watch?v=dQw4w9WgXcQ',
    'https://www.youtube.com:8443/watch?v=dQw4w9WgXcQ',
    'https://www.youtube.com/watch?v=dQw4w9WgXcQ extra',
    '',
  ])('refuses %s', (link) => {
    expect(parseMediaLink(link)).toEqual({ ok: false });
  });
});

describe('the addresses built from a provider and id', () => {
  it('plays every frame from one of the five allowed origins, YouTube from youtube-nocookie', () => {
    const frames = [
      mediaFrameSrc('youtube', 'dQw4w9WgXcQ'),
      mediaFrameSrc('vimeo', '76979871:abcdef1234'),
      mediaFrameSrc('spotify', 'track/4cOdK2wGLETKBW3PvgPWqT'),
      mediaFrameSrc('soundcloud', 'artist/a-track'),
      mediaFrameSrc('applemusic', 'us/album/the-album/1440818839/i/1440818840'),
    ];
    expect(frames.map((frame) => new URL(frame).origin)).toEqual([...MEDIA_FRAME_ORIGINS]);
    expect(frames[0]).toBe('https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?autoplay=1&rel=0');
    expect(frames[1]).toBe('https://player.vimeo.com/video/76979871?autoplay=1&dnt=1&h=abcdef1234');
    expect(frames[3]).toBe(
      'https://w.soundcloud.com/player/?url=https%3A%2F%2Fsoundcloud.com%2Fartist%2Fa-track&auto_play=true&visual=true',
    );
    expect(frames[4]).toBe('https://embed.music.apple.com/us/album/the-album/1440818839?i=1440818840');
  });

  it('reads its own share link back to the same ref, and refuses a ref no link makes', () => {
    for (const [provider, ref] of [
      ['youtube', 'dQw4w9WgXcQ'],
      ['vimeo', '76979871'],
      ['vimeo', '76979871:abcdef1234'],
      ['spotify', 'playlist/4cOdK2wGLETKBW3PvgPWqT'],
      ['soundcloud', 'artist/sets/an-album'],
      ['applemusic', 'us/song/a-song/1440818840'],
    ] as const) {
      expect(parseMediaLink(mediaShareUrl(provider, ref))).toEqual({ ok: true, provider, ref });
      expect(isMediaRef(provider, ref)).toBe(true);
    }
    expect(isMediaRef('youtube', '../../x')).toBe(false);
    expect(isMediaRef('spotify', 'dQw4w9WgXcQ')).toBe(false);
  });

  it('reads titles and posters only from each provider’s own hosts', () => {
    expect(mediaInfoSource('youtube', 'dQw4w9WgXcQ').url.href).toBe(
      'https://www.youtube.com/oembed?format=json&url=https%3A%2F%2Fwww.youtube.com%2Fwatch%3Fv%3DdQw4w9WgXcQ',
    );
    expect(mediaInfoSource('applemusic', 'us/album/x/1').kind).toBe('page');
    expect(isMediaInfoHost('youtube', new URL('https://www.youtube.com/oembed'))).toBe(true);
    expect(isMediaInfoHost('youtube', new URL('https://evil.example/oembed'))).toBe(false);
    expect(isMediaPosterHost('youtube', new URL('https://i.ytimg.com/vi/x/hqdefault.jpg'))).toBe(true);
    expect(isMediaPosterHost('youtube', new URL('http://i.ytimg.com/vi/x/hqdefault.jpg'))).toBe(false);
    expect(isMediaPosterHost('soundcloud', new URL('https://i1.sndcdn.com/a.jpg'))).toBe(true);
    expect(isMediaPosterHost('soundcloud', new URL('https://i1.sndcdn.com.evil.example/a.jpg'))).toBe(false);
    expect(isMediaPosterHost('applemusic', new URL('https://is3-ssl.mzstatic.com/a.jpg'))).toBe(true);
    expect(isMediaPosterHost('vimeo', new URL('https://169.254.169.254/latest'))).toBe(false);
  });

  it('keeps an oEmbed answer’s title and poster as plain strings, and cleans the title', () => {
    expect(readOembed({ title: ' A\nsong ', thumbnail_url: 'https://i.ytimg.com/a.jpg', html: '<iframe>' })).toEqual({
      title: 'A song',
      poster: 'https://i.ytimg.com/a.jpg',
    });
    expect(readOembed({ title: 42, thumbnail_url: ['x'] })).toEqual({});
    expect(readOembed('nope')).toEqual({});
    expect(cleanTitle('   ')).toBeUndefined();
    expect(cleanTitle(`${'word '.repeat(30)}end`)?.length).toBeLessThanOrEqual(100);
  });
});
