/**
 * The system's name, in one place. It appears in the sidebar, the mobile header,
 * page titles, the sign-in screen and the CSV export filenames - change it here
 * and every one of them follows.
 */
export const APP_NAME = "IICA-TT Internal System";

/** Shown under the logo and on the sign-in page. */
export const APP_TAGLINE = "Internal System";

/** The organisation the system belongs to. */
export const ORG_NAME = "IICA Delegation in Trinidad and Tobago";
export const ORG_SHORT = "IICA-TT";

/** Lowercase slug prefix for export filenames, derived from ORG_SHORT. */
export const EXPORT_FILE_PREFIX = ORG_SHORT.toLowerCase().replace(/[^a-z0-9-]+/g, "-");
