# SavingKC physical iPhone smoke test

This XCUITest harness launches the installed TestFlight build of SavingKC CRM and performs a read-only navigation check across Contacts, Work, Inbox, ARI, and Phone. It does not edit records, send messages, complete work, or place calls.

## One-time Mac and iPhone setup

- Install Xcode and sign in to the SavingKC Apple Developer account.
- Install XcodeGen with `brew install xcodegen`.
- Pair the iPhone with Xcode, enable Developer Mode, and sign in to SavingKC CRM once.
- For wireless runs, keep the Mac and iPhone on the same Wi-Fi. The Mac must be awake and the iPhone available and unlocked.

## Run

From the repository root:

```bash
npm run test:ios:device
```

The runner automatically selects the single available physical iPhone. If multiple iPhones are available, select one without storing its identifier in Git:

```bash
IOS_DEVICE_NAME="Ernest’s iPhone" npm run test:ios:device
```

The Apple development team can be overridden with `IOS_DEVELOPMENT_TEAM`. Local `.xcresult` bundles and the generated Xcode project are ignored by Git. Screenshots are deleted after a successful run and retained locally only when diagnosis is needed.
