import XCTest

final class SavingKCSmokeTests: XCTestCase {
    private let app = XCUIApplication(bundleIdentifier: "com.savingkc.crm")

    override func setUpWithError() throws {
        continueAfterFailure = false
        app.launch()
        addTeardownBlock { [app] in
            app.terminate()
        }
    }

    func testReadOnlyPrimaryNavigation() throws {
        XCTAssertTrue(app.wait(for: .runningForeground, timeout: 20), "SavingKC CRM did not reach the foreground")

        let signedIn = app.staticTexts["Contacts"].waitForExistence(timeout: 15)
        let signedOut = app.staticTexts["Sign in"].exists

        let launchScreenshot = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
        launchScreenshot.name = signedIn ? "savingkc-signed-in-launch" : "savingkc-signed-out-launch"
        launchScreenshot.lifetime = .deleteOnSuccess
        add(launchScreenshot)

        if signedOut {
            XCTAssertTrue(app.textFields["Email"].exists, "The email field is missing")
            XCTAssertTrue(app.secureTextFields["Password"].exists, "The password field is missing")
            XCTAssertTrue(app.buttons["Sign in"].exists, "The sign-in button is missing")
            throw XCTSkip("The app launches correctly but needs a one-time CRM sign-in before authenticated smoke tests can run.")
        }

        XCTAssertTrue(signedIn, "Neither the signed-in workspace nor the sign-in screen appeared")

        for tabName in ["Contacts", "Work", "Inbox", "ARI", "Phone"] {
            XCTAssertTrue(app.descendants(matching: .any)[tabName].exists, "Missing primary tab: \(tabName)")
        }

        app.descendants(matching: .any)["Work"].tap()
        XCTAssertTrue(app.staticTexts["My work"].waitForExistence(timeout: 15), "Work view did not load")

        app.descendants(matching: .any)["Inbox"].tap()

        app.descendants(matching: .any)["ARI"].tap()
        XCTAssertTrue(app.staticTexts["AI Assistant"].waitForExistence(timeout: 15), "ARI view did not load")

        app.descendants(matching: .any)["Phone"].tap()
        XCTAssertTrue(app.staticTexts["Phone"].waitForExistence(timeout: 15), "Phone view did not load")

        let phoneScreenshot = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
        phoneScreenshot.name = "savingkc-phone-readiness"
        phoneScreenshot.lifetime = .deleteOnSuccess
        add(phoneScreenshot)
    }
}
