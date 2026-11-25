export const PHOTO_SHARE_LIFETIME_MS=30*24*60*60*1000;
export const photoShareExpiry=createdAt=>Number(createdAt)+PHOTO_SHARE_LIFETIME_MS;
export const photoShareActive=(row,now=Date.now())=>!!row&&Number(row.expires_at)>Number(now);
