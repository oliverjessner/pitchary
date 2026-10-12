ALTER TABLE customers ADD COLUMN website TEXT NOT NULL DEFAULT '' CHECK(length(website)<=2048);
ALTER TABLE customers ADD COLUMN logo_mime TEXT CHECK(logo_mime IS NULL OR logo_mime IN ('image/png','image/jpeg','image/webp'));
ALTER TABLE customers ADD COLUMN logo_data BLOB CHECK(
 (logo_data IS NULL AND logo_mime IS NULL) OR
 (logo_data IS NOT NULL AND logo_mime IS NOT NULL AND length(logo_data) BETWEEN 1 AND 1048576)
);
