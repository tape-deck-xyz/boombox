# Changelog

All notable changes to this project will be documented in this file.

## [Unreleased]
## [0.7.0] - 2026-03-02

### e2e
* lock viewport size and fix shadow DOM selector syntax

### site-footer
* add inline link support with new-tab behaviour

### ui
* add site-footer-custom-element to layout shell

### General
* apply deno fmt formatting
* trigger pipeline test
* add lint and format check job to CircleCI workflow
* add CLAUDE.md project instructions

## [0.6.0] - 2026-02-25

### e2e
* update visual baselines after header removal

### server
* add startup config validation for S3 and admin

### ui
* remove app bar header, move upload to FAB

### General
* re-trigger CI

## [0.5.0] - 2026-02-25

### e2e
* add admin auth e2e tests

### lib
* add coverage for album and s3 utilities

### track-metadata
* keep file extension when deriving from URL path
* stabilize in-flight dedupe assertion
* unify ID3 and URL metadata derivation

## [0.4.0] - 2026-02-24

### release
* add release notes generation and annotated tags

