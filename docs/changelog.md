# 0.7.1

- Automatically fetch customer icons with Fetchary during MCP creation.
- Add a “Refetch icon” button to customer details.

# 0.7.0

- Move language selection to the new General settings tab.
- Persist German and English interface preferences using shared translation catalogs.
- Replace the People list's LinkedIn column with a sortable creation date.
- Archive rejected offers directly from the pipeline.
- Add editable offer dates, including past dates, to new and existing offers.
- Sort service table columns in both directions, matching the customer table.
- Place the automatic logo lookup hint directly below “Upload logo”.
- Separate activities in contact and offer timelines with visible dots and lines.
- Show the number of customer pitches in the service table's “Pitched” column.

# 0.6.5

- Add MCP tools to create and list customers, contacts and services; block editing, archiving, deletion and arbitrary SQL.
- Install the OJ design system from npm; update it with `npm run update:designsystem` and automatically sync browser assets and licenses.
- Clean generated build, runtime and test files after successful publishing; preserve releases, databases and backups, and skip cleanup on errors or dry runs.
- Update dependencies and align package, lockfile, Cargo and Tauri versions to `0.6.5`.

# 0.6.4

- Use `diskutil image create` on current macOS, retry temporary “Resource busy” errors and validate images before replacing existing DMGs.
- Backport the GLib fix for RUSTSEC-2024-0429 to Tauri/GTK3; run the original iterator regression tests in CI release builds.
- Preserve filters and search terms per view across navigation and reloads.
- Show only customers with revenue invoices in the revenue overview; hide standalone invoice profiles and expense-only customers.
- Add a service tag column and searchable multiselect filter, combined with text search and archive filters.

# 0.6.2

- Use OJ 0.2.2 multiselects for customer, people and pipeline tag filters, with search and keyboard support. Bundle the corrected OJ build for reproducible installs.
- Add sortable tag columns to customer and people lists.

# 0.6.1

- Restore automatic customer logos with Fetchary 2.0.4, including local HTTP websites.
- Share tags across companies and services, with customer assignments, customer and people filters, and tag preservation during customer merges.
- Sort customer and people tables in both directions using accessible column headers and direction indicators.
- Open invoice PDFs in authenticated Tauri app windows without the opener plugin intercepting internal links.
- Add direct LinkedIn profile links to the people list.
- Add a searchable people menu with archived records and direct links to contact details, offers and activities.
- Use consistent OJ selects across filters and forms, including invoices and settings.
- Add the employee view.
- Add a context menu.
- Fix false missing invoice files when closing during a folder scan and restore unchanged PDFs without reprocessing.

# 0.4.4

- Automate publishing.

# 0.1.0

- Integrate invoice management.
