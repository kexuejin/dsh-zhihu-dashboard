# Zhihu QR Login Risk-Control Handling Design

Date: 2026-08-19

## Goal

When Zhihu returns a network-environment verification challenge during QR login polling, the dashboard should make the state visible and guide the user through the official verification flow. The plugin must not try to bypass Zhihu risk control.

## Behavior

- QR login starts polling automatically after the QR code is generated.
- If polling receives a risk-control response, the host returns `risk_control` with a safe message, proxied verification URL, and non-secret diagnostics.
- The settings page stops polling and replaces the QR box with a verification card.
- The verification card embeds a same-origin host proxy page. The proxy forwards requests to Zhihu with the QR attempt's temporary Cookie jar and merges upstream `Set-Cookie` headers back into that attempt.
- The card offers “完成验证后继续检查” to resume polling with the same QR attempt and “重新生成二维码” to create a new QR code inheriting the verified temporary cookies.
- Manual refresh remains available for saved-session status only.

## Privacy

The host keeps login cookies server-side only. The frontend receives no Cookie values. Diagnostics expose only booleans and coarse status fields such as scan status, login status, and whether `z_c0` was captured.

## Non-goals

- No external-browser-only verification flow, because that does not share cookies with the QR polling client.
- No risk-control bypass.
- No new release tag until the user confirms the QR-login batch is stable.
