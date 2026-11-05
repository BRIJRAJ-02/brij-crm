// A phone number as a `tel:` link: its digits and a leading plus only, so spaces, dots and brackets never reach it.

/** `tel:+442079460000` for "+44 20 7946 0000": the one way the library links a phone number. */
export const telOf = (phone: string): string => `tel:${phone.replace(/[^\d+]/g, '')}`;
