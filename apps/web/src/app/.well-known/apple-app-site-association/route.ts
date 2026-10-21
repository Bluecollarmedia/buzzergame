import { NextResponse } from "next/server";

/**
 * iOS universal links: lets scanned https://<site>/j/<token> URLs open the
 * native player app. Set IOS_APP_ID to "<TeamID>.<bundle id>".
 */
export function GET() {
  const appId = process.env.IOS_APP_ID;
  if (!appId) return NextResponse.json({ applinks: { details: [] } });
  return NextResponse.json(
    { applinks: { details: [{ appIDs: [appId], components: [{ "/": "/j/*", comment: "Join a CrowdQuiz game" }] }] } },
    { headers: { "Content-Type": "application/json" } },
  );
}
