-- The code each create, edit or repair call answered with (GEN-10): its HTML, CSS and JavaScript,
-- kept with the call so an answer the host's checks refused can still be read in the details view.
-- Only the code: never what the person asked, nor the entries an answer starts a tool with.
ALTER TABLE request_calls ADD COLUMN code TEXT CHECK (code IS NULL OR json_valid(code));
