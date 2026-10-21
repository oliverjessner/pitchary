<p align="center">
  <img src="src-tauri/icons/128x128.png" alt="Pitchary app icon" width="128" height="128">
</p>

# Pitchary 🎯

[![Dependabot Updates](https://github.com/oliverjessner/pitchary/actions/workflows/dependabot/dependabot-updates/badge.svg)](https://github.com/oliverjessner/pitchary/actions/workflows/dependabot/dependabot-updates) [![CI](https://github.com/oliverjessner/pitchary/actions/workflows/ci.yml/badge.svg)](https://github.com/oliverjessner/pitchary/actions/workflows/ci.yml)

Pitchary is a personal CRM for customers, sales and invoices on macOS.
It brings contact history, ongoing offers and payment tracking into one place.
Your records are stored locally on your Mac.

![Pitchary dashboard showing income, expenses, overdue invoices and recent offers](src-tauri/screenshots/dashboard.png)

Add your customers and contacts, define your services and create an offer for each potential job. Record pitches, conversations and price changes as the work progresses. Import your invoice PDFs and check the dashboard to see outstanding payments alongside your sales results.

## What it does

- Manage leads, customers and contacts with searchable tags and sortable lists.
- Define reusable services and track offered and agreed prices for each job.
- Follow offers from the first pitch to acceptance, completion or rejection.
- Keep a history of conversations, status changes and price negotiations.
- Import invoice PDFs, read scanned text with OCR and optionally recognize invoice details with AI.
- Monitor invoice folders and track open, paid and overdue invoices.
- Review income, expenses, customer revenue and sales win rates.

## Install

The current download requires an Apple Silicon Mac running macOS 27 or later. The app interface is in German.

### Homebrew

```sh
brew install --cask oliverjessner/tap/pitchary
```

### Download

Download the DMG from the [latest release](https://github.com/oliverjessner/pitchary/releases/latest), open it and drag **Pitchary** into **Applications**.

The app is currently not notarized. If macOS blocks the first launch, allow it under **System Settings → Privacy & Security → Open Anyway**.

## Customers and contacts

Keep company details, contact people and notes together, and group companies with colored tags. Search contacts by name, company, role or email, then open their contact details, offers and activity history.

![Customer directory with lead and customer status, colored tags, notes and search filters](src-tauri/screenshots/customers.png)

## Services, offers and negotiations

Reuse your services across offers, set a price and billing period for each job, and follow its progress in the pipeline. Record pitches, follow-ups and negotiated prices so you can review how each agreement developed.

![Sales pipeline with offers grouped by stage, prices, contact people and time in each stage](src-tauri/screenshots/pipeline.png)

## Invoice imports and payment tracking

Import income and expense invoice PDFs, review their details and mark them as paid. Text extraction and OCR run locally; you can enter invoice details manually or enable automatic recognition with your own OpenAI API key, which sends extracted invoice text to OpenAI.

![Income invoices with dates, customers, amounts, payment controls and links to the original PDFs](src-tauri/screenshots/invoices.png)

## Automatic invoice folder imports

Choose separate folders for income and expense invoices to import PDFs when Pitchary starts and when files change while it is running. Check the monitoring status or scan the folders manually from Settings.

![Invoice folder settings with separate income and expense paths, monitoring status and a manual scan button](src-tauri/screenshots/finance-settings-watcher.png)

## Customer revenue and expenses

See which customers account for your invoice revenue and which suppliers account for your largest expenses in a selected year. Search the customer list to review invoice totals and the date of the latest invoice.

![Revenue overview with top customers, largest expenses and customer invoice totals](src-tauri/screenshots/finance-customers.png)

## Sales results and win rates

Compare results by customer, service and pitch channel, including win rates and the time from pitch to acceptance. Review offered and agreed values, rejection reasons and offers still awaiting a decision.

![Sales analytics with win rates, order values and performance by service, customer and pitch channel](src-tauri/screenshots/analytics.png)

## Who it is for

- Freelancers managing their own clients, offers and invoices.
- Independent consultants tracking pitches and price negotiations.
- Solo service business owners reviewing customer revenue and expenses.

## Changelog

See the [changelog](docs/changelog.md) for release notes and changes.

## License

MIT
