import type { Metadata } from "next";
import Link from "next/link";
import { H2, LegalPage, Mail, P, UL } from "@/components/legal/LegalPage";
import { legal } from "@/lib/legal";

export const metadata: Metadata = { title: "Support" };

export default function SupportPage() {
  return (
    <LegalPage title={`${legal.appName} support`} intro="Need help with a game, your account, or something that does not look right? Start here, or write to us.">
      <H2>Contact us</H2>
      <P>Email <Mail />. Please include what you were doing, what you expected, and what happened. Replies usually come within one working day.</P>

      <H2>Common questions</H2>
      <P><strong>How do I join a game?</strong> Open the app, tap “Scan QR code”, and point the camera at the code on the big screen. If you cannot scan, type the 6-character room code instead. You do not need an account.</P>
      <P><strong>The camera will not open.</strong> Turn on camera access for {legal.appName} in your phone’s Settings, or type the room code.</P>
      <P><strong>I got disconnected during a game.</strong> Open the app and scan or type the code again. You rejoin as the same player with your score.</P>
      <P><strong>How do I turn off vibration?</strong> Account tab, then switch off “Vibration”.</P>
      <P><strong>How do I delete my account?</strong> Account tab, then “Delete account”. Everything linked to the account is permanently deleted straight away.</P>
      <P><strong>My quiz changes disappeared.</strong> Quizzes save as you type. If you were offline, the app keeps your edits on the phone and saves them when you open the quiz again with a connection.</P>
      <P><strong>I cannot start a game.</strong> Running games needs hosting access on your account. Write to us if it is not turned on.</P>

      <H2>Report a problem</H2>
      <UL>
        <li>To report a player, a quiz or a host, write to <Mail /> with the room code and the name involved.</li>
        <li>Hosts can remove a player right away from the game screen.</li>
      </UL>

      <H2>More</H2>
      <P>
        <Link className="font-medium text-primary underline" href="/privacy">Privacy Policy</Link> ·{" "}
        <Link className="font-medium text-primary underline" href="/terms">Terms of Use</Link>
      </P>
    </LegalPage>
  );
}
