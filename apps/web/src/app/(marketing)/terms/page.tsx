import type { Metadata } from "next";
import { H2, LegalPage, Mail, P, UL } from "@/components/legal/LegalPage";
import { legal } from "@/lib/legal";

export const metadata: Metadata = { title: "Terms of Use" };

export default function TermsPage() {
  return (
    <LegalPage
      title="Terms of Use"
      intro={`These terms apply when you use the ${legal.appName} app or its website. By using them you agree to these terms. If you do not agree, please do not use the service.`}
    >
      <H2>Using the service</H2>
      <UL>
        <li>Players can join a game without an account. Hosts need an account and must be at least 13 years old.</li>
        <li>You are responsible for your account and for keeping your password secret. Tell us if you think someone else has used it.</li>
        <li>Some features, such as running games, may need hosting access that is turned on for your account.</li>
      </UL>

      <H2>Content and behaviour</H2>
      <P>Hosts write the questions, answers and photos shown in a game, and players choose their own display names. Everyone must follow these rules. Do not use the service to share or create anything that:</P>
      <UL>
        <li>is hateful, harassing, threatening, sexually explicit, or encourages violence or self-harm;</li>
        <li>shows or targets a private person without their permission, or exposes personal information;</li>
        <li>infringes someone else’s copyright, trademark or other rights;</li>
        <li>is illegal, misleading, or tries to disrupt the service (for example by automated or abusive requests).</li>
      </UL>
      <P>You keep ownership of the content you create. You give us permission to store it and show it to the players and screens in your games, so we can run the service.</P>

      <H2>Moderation and reports</H2>
      <UL>
        <li>Hosts can remove any player from their game at any time.</li>
        <li>You can report a player, a quiz or a host from the Account tab (“Report a problem or a player”) or by writing to <Mail />. We review reports and act on them promptly, normally within 24 hours.</li>
        <li>We may remove content, disable accounts, or end games that break these rules or put people at risk.</li>
      </UL>

      <H2>Your account</H2>
      <P>You can delete your account at any time in the app (Account tab, “Delete account”). Deleting it permanently removes your quizzes, photos, games and results. We may suspend or end accounts that break these terms.</P>

      <H2>Availability and changes</H2>
      <P>We work hard to keep the service running, but we cannot promise it will always be available or error-free, and we may change or stop features. Games in progress can be interrupted by problems with your internet connection or ours.</P>

      <H2>Disclaimers and liability</H2>
      <P>The service is provided “as is” without warranties of any kind. To the extent the law allows, we are not liable for indirect or consequential losses, or for content created by hosts and players. Nothing in these terms limits rights that the law says cannot be limited.</P>

      <H2>Changes to these terms</H2>
      <P>We may update these terms. The date at the top shows the latest version. If you keep using the service after a change, you accept the new terms.</P>

      <H2>Contact</H2>
      <P>Questions about these terms: <Mail />.</P>
    </LegalPage>
  );
}
