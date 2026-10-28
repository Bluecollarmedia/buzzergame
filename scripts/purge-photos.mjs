// Question photos now live in Cloudflare R2, and the website deletes expired
// ones: Admin tab → Overview → "Delete expired photos".
//
// This script is kept so `pnpm purge:photos` explains where it went.
console.log('Photos are stored in Cloudflare R2 now. Use the website: Admin → Overview → "Delete expired photos".');
