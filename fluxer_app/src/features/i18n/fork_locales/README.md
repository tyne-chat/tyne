# Fork-only translations

Strings that exist only in this fork live here, one `messages.po` per locale. The upstream
catalogues in `../locales` are never edited by the fork, so they stay identical to upstream and
cannot conflict on rebase. At runtime `src/app/ForkI18n.ts` layers these catalogues over the
upstream ones.

After adding, changing or removing a user-facing string, from `fluxer_app`:

1. `node scripts/fork-i18n.mjs sync` adds new fork-only strings with an empty `msgstr` and removes
   the ones no longer used (or since adopted by upstream).
2. Translate every empty `msgstr` in every locale. Do not copy the English text; if a string is
   meant to be identical in all languages, add its msgid to `reviewed-unchanged.json`.
3. `node scripts/fork-i18n.mjs check` and `pnpm lingui:compile` must pass.

Never run `pnpm lingui:extract` and commit the result: it rewrites the upstream catalogues.
After a rebase, `node scripts/fork-i18n.mjs check --upstream <upstream ref>` also verifies that
the upstream catalogues are untouched.
