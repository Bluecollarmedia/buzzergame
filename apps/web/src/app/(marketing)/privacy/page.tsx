import type { Metadata } from "next";
import { H2, LegalPage, Mail, P, UL } from "@/components/legal/LegalPage";
import { legal } from "@/lib/legal";

export const metadata: Metadata = { title: "Privacy Policy" };

export default function PrivacyPage() {
  return (
    <LegalPage
      title="Privacy Policy"
      intro={`This policy explains what information the ${legal.appName} app and its website collect, why, how long we keep it, and the choices you have. It covers both players and hosts. ${legal.operator[0]!.toUpperCase()}${legal.operator.slice(1)} (“we”, “us”) runs the service.`}
    >
      <H2>The short version</H2>
      <UL>
        <li>Players do not need an account. We store only the name you type for a game, your answers and your score.</li>
        <li>Hosts create an account with an email address and password so they can save quizzes.</li>
        <li>We do not sell your information, show ads, or track you across other apps and websites.</li>
        <li>You can delete your account, and everything linked to it, inside the app at any time.</li>
      </UL>

      <H2>Information we collect</H2>
      <P><strong>If you play a game (no account):</strong></P>
      <UL>
        <li>The display name you choose. It is shown to the host and the other players in that game. Please do not use your real full name.</li>
        <li>Your answers, when they were received, and your points.</li>
        <li>A random secret created on your phone for each game. We keep only a one-way hash of it. It lets you rejoin the same game if the app closes.</li>
        <li>When you joined and when your phone was last connected to the game.</li>
      </UL>
      <P><strong>If you create a host account:</strong></P>
      <UL>
        <li>Your name, email address and password. Your password is stored only as a salted hash by our sign-in provider.</li>
        <li>The quizzes, questions, answer choices and photos you create, and the games you run with their results (including the display names, answers and scores of the players in them).</li>
        <li>Records of hosting access on your account, and a log of important actions (for example launching a game or deleting an account) kept for security.</li>
      </UL>
      <P><strong>On your device:</strong></P>
      <UL>
        <li><strong>Camera.</strong> The app asks to use the camera only when you tap “Scan QR code”. It reads the code and shows nothing else. No photos or video are taken, saved or uploaded.</li>
        <li><strong>Photos.</strong> If you add a picture to a question, the app opens the system photo picker. It can see only the one picture you choose. That picture is resized and uploaded to your account.</li>
        <li><strong>Saved on the phone.</strong> Your sign-in (in the iPhone Keychain or Android Keystore), the per-game secret, your vibration setting, and a temporary backup of quiz edits that have not finished saving.</li>
        <li><strong>On the website</strong> hosts get a sign-in cookie, and the browser keeps the per-game secret for 24 hours. We use no advertising or tracking cookies.</li>
      </UL>
      <P>We do not collect your contact list, location, advertising identifier or device identifiers. The app has no advertising or analytics code. Our servers use network addresses only to limit abuse, in counters that are deleted after one hour.</P>

      <H2>How we use it</H2>
      <UL>
        <li>To run games: let players join, take answers, work out who was first, score, and show results to the host and the big screen.</li>
        <li>To provide host accounts: sign you in, save your quizzes and photos, and let you run games.</li>
        <li>To keep the service safe and working: prevent abuse, fix problems, and answer support requests.</li>
      </UL>
      <P>We do not use your information for advertising, and we do not use it to profile you.</P>

      <H2>Who can see it</H2>
      <UL>
        <li><strong>In a game:</strong> your display name and score are visible to the host and the other players. A question photo is shown on the host’s big screen and host devices.</li>
        <li><strong>Question photos</strong> are stored at an unguessable web address. Anyone who has the exact address can open the picture, so do not upload anything private.</li>
        <li><strong>Our service providers</strong> host the database, sign-in, file storage and website for us, and send account emails (such as email confirmation and password reset). They process data only to provide these services to us.</li>
        <li>We may disclose information if the law requires it, or to protect people from harm.</li>
      </UL>

      <H2>How long we keep it</H2>
      <UL>
        <li>Finished or cancelled games, with player names, answers and scores: deleted automatically 90 days after the game ends. Hosts can delete a game sooner.</li>
        <li>Games that are never finished: cancelled after 24 hours of no activity, then deleted on the same schedule.</li>
        <li>Security log entries: 365 days.</li>
        <li>Network-address counters used to limit abuse: 1 hour.</li>
        <li>Host accounts, quizzes and photos: until you delete them or your account.</li>
      </UL>

      <H2>Your choices and rights</H2>
      <UL>
        <li><strong>Delete your account in the app:</strong> Account tab, then “Delete account”. This immediately and permanently deletes your account, quizzes, questions, photos, games and results. Players are not asked to create accounts, so there is nothing to delete for them; their game data is removed automatically as described above.</li>
        <li><strong>Ask us:</strong> you can ask to see, correct, export or delete information about you by writing to <Mail />. If you played as a guest, tell us the game and the name you used so we can find it. Depending on where you live (for example the EU, UK or California) you may have additional legal rights, and we will honour them.</li>
        <li><strong>Camera and photos:</strong> you can turn either off in your phone’s Settings. You can still join a game by typing the room code.</li>
      </UL>

      <H2>Children</H2>
      <P>The service is not directed to children under 13, and hosts must be at least 13. We do not knowingly collect personal information from children under 13 for host accounts. If you believe a child has created an account, write to <Mail /> and we will delete it. Anyone who joins a game should use a nickname, not a real name.</P>

      <H2>Where your information is stored</H2>
      <P>Information is stored with our hosting providers and may be processed in countries other than where you live. We protect it with encryption in transit, access controls and database rules that keep each host’s data separate.</P>

      <H2>Changes</H2>
      <P>If we change this policy in a way that matters, we will update the date above and, for host accounts, tell you in the app or by email.</P>

      <H2>Contact</H2>
      <P>Questions or requests: <Mail />{legal.address ? <>. Postal address: {legal.address}</> : null}.</P>
    </LegalPage>
  );
}
