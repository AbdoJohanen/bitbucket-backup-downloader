# Bitbucket Backup Downloader

This project provides a simple Node.js script that mirrors all repositories in a Bitbucket workspace to a local folder, with error logging and retry/backoff logic.

## What it does

* Fetches the list of all repositories in your configured Bitbucket workspace (paginated).
* For each repository, either:

  * Clones it as a bare mirror if it doesn’t exist locally, or
  * Fetches updates (`git fetch --all --prune`) if it already exists.
* Logs informational messages to the console.
* Logs errors (with full stack traces) to `logs/error-<timestamp>.log`.
* Retries API calls and Git commands on transient failures with exponential backoff.

## Prerequisites

* Node.js (v18+)
* npm
* A Bitbucket account with an App Password that has **Repository: Read** scope

## Setup

1. Clone or download this folder to your server, e.g.:

   ```bash
   git clone https://github.com/AbdoJohanen/bitbucket-backup-downloader.git
   ```
2. Install dependencies:

   ```bash
   cd bitbucket-backup-downloader
   npm install
   ```
3. Create a `.env` file in the project root with the following variables:

   ```dotenv
   BITBUCKET_USER=your.bitbucket.username
   BITBUCKET_APP_PASSWORD=yourAppPassword
   BITBUCKET_WORKSPACE=yourWorkspaceID
   ```

## Usage

Run the backup manually:

```bash
node backup.js
```

## Directory structure

```
bitbucket-backup-downloader/
├── backup.js          # Main script
├── package.json       # npm project file
├── .env               # Environment variables (not checked in)
├── downloads/         # Local mirrors of each repo (bare .git folders)
└── logs/
    └── error-<timestamp>.log  # Error logs
```
