import Capacitor
import GameKit

/**
 * Game Center — the Daily Fold leaderboard and the achievements.
 *
 * WHY THIS IS HAND-WRITTEN. The published Capacitor plugin for Game Center is a
 * major version behind this app's Capacitor, and it bundles Google Play Games
 * alongside Apple's — a second native dependency, a second privacy manifest and
 * a second thing to keep alive, for a surface this small. This file is the whole
 * of it: sign in, post a time, report an achievement, and open Apple's own two
 * screens.
 *
 * EVERY METHOD RESOLVES. Game Center is a nice-to-have on top of a game that
 * works offline and has no account: a player who is signed out, underage,
 * offline or simply uninterested must lose the leaderboard and nothing else. So
 * failures come back as `{ ok: false }` rather than as rejected promises the
 * caller has to remember to catch.
 */
@objc(GameCenterPlugin)
public class GameCenterPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "GameCenterPlugin"
    public let jsName = "GameCenter"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "authenticate", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "submitScore", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "showLeaderboard", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "reportAchievement", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "showAchievements", returnType: CAPPluginReturnPromise)
    ]

    /**
     * Sign the player in.
     *
     * GameKit hands back a view controller when it wants credentials, and the
     * contract is that you present it — ignoring it leaves the player
     * permanently unauthenticated with no way to fix it. It is presented over
     * whatever is on screen, which at launch is the game.
     *
     * The handler can fire more than once over a session (a player switching
     * accounts, returning from Settings), so the promise is resolved exactly
     * once and later calls only update state.
     *
     * The sheet is presented only from a view controller that is free. UIKit
     * refuses to present from one that is already presenting — the ad consent
     * alert goes up on this same controller — and it refuses silently: no
     * sheet, no second call of the handler, and a promise that never settled.
     * So a busy controller resolves `ok: false` with a reason, and the JS side
     * reads that reason as "never asked" and may try again later.
     */
    @objc func authenticate(_ call: CAPPluginCall) {
        var settled = false
        let finish: (Bool, String?) -> Void = { ok, reason in
            guard !settled else { return }
            settled = true
            var result: [String: Any] = ["ok": ok]
            if let reason = reason { result["reason"] = reason }
            call.resolve(result)
        }

        DispatchQueue.main.async {
            GKLocalPlayer.local.authenticateHandler = { viewController, _ in
                if let viewController = viewController {
                    guard let host = self.bridge?.viewController else {
                        finish(false, "no-view-controller")
                        return
                    }
                    guard host.presentedViewController == nil else {
                        finish(false, "presenter-busy")
                        return
                    }
                    host.present(viewController, animated: true)
                    // Not settled yet: the player is being asked. The handler
                    // runs again with the answer.
                    return
                }
                finish(GKLocalPlayer.local.isAuthenticated, nil)
            }
        }
    }

    /**
     * Post a time to the Daily Fold board.
     *
     * The score is in CENTISECONDS, because App Store Connect offers no
     * millisecond formatter — the game divides its stored milliseconds by ten
     * before calling this, and the board is configured ELAPSED_TIME_CENTISECOND
     * to match. Getting that pair wrong would show every time ten times too
     * large and there would be nothing in the app to reveal it.
     */
    @objc func submitScore(_ call: CAPPluginCall) {
        guard GKLocalPlayer.local.isAuthenticated else {
            call.resolve(["ok": false, "reason": "not-authenticated"])
            return
        }
        guard let leaderboardID = call.getString("leaderboardID"),
              let score = call.getInt("score") else {
            call.resolve(["ok": false, "reason": "bad-arguments"])
            return
        }

        GKLeaderboard.submitScore(
            score,
            context: 0,
            player: GKLocalPlayer.local,
            leaderboardIDs: [leaderboardID]
        ) { error in
            call.resolve(["ok": error == nil, "reason": error?.localizedDescription ?? ""])
        }
    }

    /** Open Game Center's own board. Resolves when it has been shown. */
    @objc func showLeaderboard(_ call: CAPPluginCall) {
        guard GKLocalPlayer.local.isAuthenticated else {
            call.resolve(["ok": false, "reason": "not-authenticated"])
            return
        }
        guard let leaderboardID = call.getString("leaderboardID") else {
            call.resolve(["ok": false, "reason": "bad-arguments"])
            return
        }

        DispatchQueue.main.async {
            let vc = GKGameCenterViewController(
                leaderboardID: leaderboardID,
                playerScope: .global,
                timeScope: .today
            )
            vc.gameCenterDelegate = self
            guard let host = self.bridge?.viewController else {
                call.resolve(["ok": false, "reason": "no-view-controller"])
                return
            }
            host.present(vc, animated: true) { call.resolve(["ok": true]) }
        }
    }
}

extension GameCenterPlugin {
    /**
     * Mark an achievement earned.
     *
     * Fire-and-forget by design: the game reports the same achievements every
     * time the condition holds, and GameKit is the one that knows whether it
     * has already been earned. Reporting an earned achievement again is a
     * no-op, which is what lets the caller stay stateless.
     */
    @objc func reportAchievement(_ call: CAPPluginCall) {
        guard GKLocalPlayer.local.isAuthenticated else {
            call.resolve(["ok": false, "reason": "not-authenticated"])
            return
        }
        guard let identifier = call.getString("identifier") else {
            call.resolve(["ok": false, "reason": "bad-arguments"])
            return
        }

        let achievement = GKAchievement(identifier: identifier)
        achievement.percentComplete = call.getDouble("percent") ?? 100
        // The banner is GameKit's own, and it is the only thing that tells the
        // player anything happened.
        achievement.showsCompletionBanner = true

        GKAchievement.report([achievement]) { error in
            call.resolve(["ok": error == nil, "reason": error?.localizedDescription ?? ""])
        }
    }

    /** Game Center's achievements screen. */
    @objc func showAchievements(_ call: CAPPluginCall) {
        guard GKLocalPlayer.local.isAuthenticated else {
            call.resolve(["ok": false, "reason": "not-authenticated"])
            return
        }
        DispatchQueue.main.async {
            let vc = GKGameCenterViewController(state: .achievements)
            vc.gameCenterDelegate = self
            guard let host = self.bridge?.viewController else {
                call.resolve(["ok": false, "reason": "no-view-controller"])
                return
            }
            host.present(vc, animated: true) { call.resolve(["ok": true]) }
        }
    }
}

extension GameCenterPlugin: GKGameCenterControllerDelegate {
    public func gameCenterViewControllerDidFinish(
        _ gameCenterViewController: GKGameCenterViewController
    ) {
        gameCenterViewController.dismiss(animated: true)
    }
}

/**
 * The app's bridge view controller: Capacitor's own, plus the plugins that live
 * in this target.
 *
 * WHY IT EXISTS. Capacitor registers only the classes named in
 * capacitor.config.json `packageClassList`, and `cap sync` builds that list from
 * npm packages. GameCenterPlugin is not an npm package, so it is never in the
 * list, and without this subclass `registerPlugin('GameCenter')` on the JS side
 * talks to nothing. src/systems/GameCenter.ts catches that and reads it as
 * "not signed in", so the failure is silent: sign-in, the Daily Fold board and
 * achievements simply never happen.
 *
 * capacitorDidLoad() runs after the bridge exists and before the web view loads
 * the game, so the plugin is registered by the time any script asks for it.
 *
 * Main.storyboard names this class (customModule "App"), and the UIScene
 * configuration in Info.plist (UISceneStoryboardFile = Main) is what creates
 * it: once, as the root of the scene's window. SceneDelegate deliberately
 * builds no controller of its own. Anything that ever does create the root
 * view controller in code must create this class, not a plain
 * CAPBridgeViewController.
 */
class FoldwingBridgeViewController: CAPBridgeViewController {
    override open func capacitorDidLoad() {
        bridge?.registerPluginInstance(GameCenterPlugin())
    }
}
