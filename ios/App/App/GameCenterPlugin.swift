import Capacitor
import GameKit

/**
 * Game Center — the Daily Fold leaderboard, and nothing else.
 *
 * WHY THIS IS HAND-WRITTEN. The published Capacitor plugin for Game Center is a
 * major version behind this app's Capacitor, and it bundles Google Play Games
 * alongside Apple's — a second native dependency, a second privacy manifest and
 * a second thing to keep alive, for a surface that is three GameKit calls. This
 * file is those three calls.
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
        CAPPluginMethod(name: "showLeaderboard", returnType: CAPPluginReturnPromise)
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
     */
    @objc func authenticate(_ call: CAPPluginCall) {
        var settled = false
        let finish: (Bool) -> Void = { ok in
            guard !settled else { return }
            settled = true
            call.resolve(["ok": ok])
        }

        DispatchQueue.main.async {
            GKLocalPlayer.local.authenticateHandler = { viewController, _ in
                if let viewController = viewController {
                    self.bridge?.viewController?.present(viewController, animated: true)
                    // Not settled yet: the player is being asked. The handler
                    // runs again with the answer.
                    return
                }
                finish(GKLocalPlayer.local.isAuthenticated)
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

extension GameCenterPlugin: GKGameCenterControllerDelegate {
    public func gameCenterViewControllerDidFinish(
        _ gameCenterViewController: GKGameCenterViewController
    ) {
        gameCenterViewController.dismiss(animated: true)
    }
}
