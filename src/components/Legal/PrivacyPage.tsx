import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { LegalPage, H2, P, UL } from './LegalPage'

export default function PrivacyPage() {
  const { t } = useTranslation()
  return (
    <LegalPage title={t('pages.legal.privacyTitle')} lastUpdated="2026-09-11">
      <P>
        This Privacy Policy (the "Policy") describes the practices of the operator of
        funradar.app (the "Operator", "we", "us", or "our") with respect to the
        collection, use, disclosure, retention, and protection of information obtained
        from or about visitors (each, a "User") in connection with the User's access to
        and use of the funradar.app website, application programming interfaces, mobile
        applications, and all related content and functionality (collectively, the
        "Service"). This Policy is incorporated into and forms an integral part of the
        Terms of Service governing the Service. Capitalized terms used but not otherwise
        defined herein shall have the meanings ascribed to them in the Terms of Service.
      </P>

      <H2>1. Scope and Applicability</H2>
      <P>
        This Policy applies exclusively to information processed in connection with the
        Service. It does not apply to information collected by any third party, including
        without limitation any third-party website, application, or service to which the
        Service may link or refer. The User's interactions with such third parties shall
        be governed solely by the privacy policies of those respective third parties.
      </P>

      <H2>2. User Accounts (Optional Sign-In); Newsletter Subscriptions</H2>
      <P>
        The Service may be used in its substantial entirety without the creation of a
        user account. The User may, at the User's sole election, sign in through Google
        Sign-In in order to access certain gated content (including event details).
        Where the User so elects, the Operator collects and stores: (a) the electronic
        mail address associated with the User's Google account, as verified by Google
        LLC; (b) the sign-in provider; (c) timestamps of account creation and most
        recent sign-in; and (d) the metropolitan area whose map initiated the sign-in.
        The Operator does not receive or store the User's Google password or any other
        Google account credential. Where the User separately elects to subscribe to the
        Operator's electronic mail newsletter — whether by submitting an electronic mail
        address through a form on the Service or by accepting the newsletter option
        presented at sign-in (which may be presented pre-selected and may be declined
        by deselecting it before signing in) — the Operator stores such electronic
        mail address, together with the source and metropolitan area of the
        subscription, for the sole purpose of delivering the newsletter. The User may
        unsubscribe at any time by the means stated in the newsletter or by written
        request to frolicmap.official@gmail.com, and may request deletion of the User's account
        and associated data in the manner described in Section 12 hereof. Access to the
        administrative interface located at the path "/admin" is restricted to
        authorized personnel and is governed by Cloudflare Access authentication; such
        interface is not available to the general public.
      </P>

      <H2>3. Geolocation Data</H2>
      <P>
        Where the User elects to invoke the "Nearby activities" functionality, the User's
        web browser shall request the User's permission to access geolocation data
        provided by the User's device. Any such geolocation coordinates are processed
        exclusively within the User's browser environment for the purpose of centering
        the map display and filtering listings by proximity. Such geolocation
        coordinates are not transmitted to the Operator's servers, are not logged, are
        not retained, and are not disclosed to any third party. The User may withdraw
        geolocation permission at any time through the User's browser or device settings.
      </P>

      <H2>4. Server-Level Information and Abuse Prevention</H2>
      <P>
        When the User's web browser issues a request to the Service's application
        programming interfaces, the Operator's edge infrastructure (provided by
        Cloudflare, Inc.) processes the originating Internet Protocol ("IP") address on
        a transient basis solely for the purposes of: (a) routing the request; (b)
        enforcing per-IP rate limits; and (c) detecting and mitigating abusive,
        automated, or fraudulent activity. The Operator does not maintain persistent,
        long-term request logs and does not construct or retain any behavioral profile
        of any individual User.
      </P>

      <H2>5. Session Tokens</H2>
      <P>
        For the purpose of mitigating unauthorized bulk extraction of the Curated
        Database, the Service issues to the User's browser, upon initial page load, a
        cryptographically signed, short-duration (five-minute) anonymous session token.
        Such token contains only a timestamp, a random nonce, and a Hash-based Message
        Authentication Code ("HMAC") signature; it does not contain, encode, or
        reference any personally identifying information. The token is retained solely
        in the volatile memory of the User's browser, is not written to persistent
        storage, is not transmitted as an HTTP cookie, and cannot be used to identify
        or track the User across browsing sessions or devices.
      </P>

      <H2>6. Cookies and Similar Technologies</H2>
      <P>
        The publicly accessible portion of the Service does not set tracking cookies for
        purposes of advertising, behavioral targeting, or cross-site profiling.
        Cloudflare, in its capacity as the Operator's edge infrastructure provider,
        may set strictly necessary cookies (such as "__cf_bm") for the purpose of
        distinguishing automated traffic from human traffic and otherwise securing
        the Service, in accordance with Cloudflare's then-current configuration; any
        such cookie contains no personal data and is not used for any advertising
        purpose. The administrative interface at "/admin" sets a Cloudflare Access
        session cookie applicable solely to authorized administrative personnel.
      </P>

      <H2>7. Analytics</H2>
      <P>
        The Operator does not currently employ any third-party web analytics service
        on the publicly accessible portion of the Service. If, in the future, the
        Operator elects to enable a web analytics service, it shall employ a
        privacy-preserving service that does not utilize cookies, does not engage in
        cross-site tracking, and does not perform device fingerprinting, and shall
        update this Policy accordingly. Cloudflare, in its capacity as the Operator's
        edge infrastructure provider, may make available to the Operator
        aggregated, request-level metrics (such as request counts and response
        statuses) for the purpose of operating and securing the Service.
      </P>

      <H2>8. Third-Party Service Providers</H2>
      <P>
        Certain functions of the Service rely upon services provided by independent
        third parties, to which the User's web browser may transmit information
        incidental to the User's use of those functions. Such third parties include,
        without limitation:
      </P>
      <UL>
        <li>(a) basemap tile providers, including CARTO and OpenStreetMap, which receive standard hypertext-transfer-protocol requests for cartographic tile imagery;</li>
        <li>(b) geocoding service providers, which receive search queries entered by the User into the address search interface; and</li>
        <li>(c) external destination websites accessed via outbound hyperlinks, which receive standard referer information upon navigation.</li>
      </UL>
      <P>
        Such third parties are independent controllers of any information received in
        the course of providing their respective services, and their processing of such
        information is governed by their respective privacy policies. The Operator does
        not transmit, sell, share, or otherwise disclose User data to such third
        parties beyond the information that the User's browser transmits in the ordinary
        course of fetching the relevant resource.
      </P>

      <H2>9. User Submissions and Correspondence</H2>
      <P>
        Where the User submits a report concerning a listing through the Service's
        reporting function, the substance of such report and the identifier of the
        listing concerned are stored in the Operator's database for the purpose of
        editorial review by authorized personnel. Where a signed-in User submits a
        proposed place or event through the Service's "Suggest a place or event"
        function, the content of such submission (including the proposed name,
        category, location, and any description, website, or timing information
        provided by the User) is stored in the Operator's database, together with
        the identifier of the User's account, for the purpose of editorial review
        by authorized personnel. Should such a submission be approved for
        publication, only the submitted content — and not the identity of the
        submitting User — becomes part of the Curated Database publicly displayed
        by the Service; the association between the published listing and the
        submitting User's account is retained internally, and is visible solely to
        authorized personnel, as an editorial record. Where the User initiates
        electronic mail correspondence with the Operator at frolicmap.official@gmail.com, the
        User's electronic mail address and the contents of such correspondence are
        processed and retained by the Operator's electronic mail service provider
        for the purpose of facilitating a response. The Operator shall not use such
        electronic mail addresses for marketing communications.
      </P>

      <H2>10. Children's Privacy</H2>
      <P>
        The Service is intended for use by adults selecting activities for children in
        their care. The Operator does not knowingly solicit, collect, or retain any
        personally identifying information from any child under the age of thirteen
        (13). In the event that a parent or legal guardian becomes aware that a child
        has submitted personally identifying information through the Service, such
        parent or guardian may contact the Operator at frolicmap.official@gmail.com and the
        Operator shall promptly delete such information.
      </P>

      <H2>11. Data Retention</H2>
      <P>
        The Operator retains only such information as is reasonably necessary for the
        operation of the Service, namely: (a) the Curated Database, which is publicly
        displayed; (b) editorial moderation records associated with the Curated
        Database; (c) electronic mail correspondence directed to the Operator; (d)
        account records created through the optional sign-in described in Section 2,
        retained until the User requests deletion; and (e) newsletter subscriptions,
        retained until the User unsubscribes or requests deletion. The Operator does
        not maintain any per-User behavioral record.
      </P>

      <H2>12. Rights of Users</H2>
      <P>
        Depending upon the User's jurisdiction of residence, the User may possess
        certain rights with respect to personal information held by the Operator,
        including, without limitation, rights of access, correction, deletion,
        portability, and objection to processing under the California Consumer Privacy
        Act of 2018 (as amended by the California Privacy Rights Act of 2020), the
        General Data Protection Regulation (Regulation (EU) 2016/679), the United
        Kingdom General Data Protection Regulation, and analogous laws of other
        jurisdictions. The personal information the Operator holds attributable to a
        specific User is limited to that described in Sections 2 and 9 hereof (an
        optional account record, an optional newsletter subscription, any reports
        or place/event submissions made through the Service, and any
        correspondence); the Operator maintains no per-User behavioral profile. The
        User may exercise any applicable rights — including deletion of the User's
        account record and newsletter subscription — by submitting a written request
        to{' '}
        <a href="mailto:frolicmap.official@gmail.com" style={{ color: '#f59e0b' }} className="hover:underline">frolicmap.official@gmail.com</a>.
        Without prejudice to the foregoing, a signed-in User may delete the User's
        account record, together with any associated newsletter subscription, directly
        within the Service by opening the Help &amp; FAQ panel and selecting "Delete
        account" in the Account section thereof, and any User may unsubscribe from the
        newsletter without deleting the User's account at{' '}
        <Link to="/unsubscribe" style={{ color: '#f59e0b' }} className="hover:underline">funradar.app/unsubscribe</Link>.
      </P>

      <H2>13. Sale or Sharing of Personal Information</H2>
      <P>
        The Operator does not sell personal information, as such term is defined under
        the California Consumer Privacy Act, and does not share personal information
        with third parties for purposes of cross-context behavioral advertising. No
        such sale or sharing has occurred during the twelve (12) months preceding the
        effective date set forth at the top of this Policy.
      </P>

      <H2>14. Security Measures</H2>
      <P>
        All traffic between the User's browser and the Service is transmitted exclusively
        over the Hypertext Transfer Protocol Secure ("HTTPS") protocol. The
        administrative interface is protected by Cloudflare Access. The Service
        implements defense-in-depth measures, including HMAC-signed session tokens,
        per-IP rate limiting, and origin validation, on all data endpoints.
        Notwithstanding the foregoing, no method of transmission over the Internet or
        method of electronic storage is wholly secure, and the Operator does not warrant
        absolute security of any information.
      </P>

      <H2>15. International Data Transfers</H2>
      <P>
        The Service is operated from infrastructure located in the United States of
        America. By accessing or using the Service from a jurisdiction outside the
        United States, the User acknowledges that any limited information processed in
        connection with such access may be transferred to, stored in, or processed in
        the United States or in any other jurisdiction in which the Operator's service
        providers maintain facilities.
      </P>

      <H2>16. Modifications to This Policy</H2>
      <P>
        The Operator reserves the right, in its sole discretion, to modify this Policy
        at any time. Any such modification shall become effective upon posting to the
        Service, and the "Last updated" date set forth at the top of this Policy shall
        be revised to reflect the date of the most recent revision. The User's continued
        use of the Service following the posting of any modified Policy shall constitute
        the User's acceptance of the modified Policy.
      </P>

      <H2>17. Contact Information</H2>
      <P>
        Any inquiry, request, or complaint regarding this Policy or the Operator's
        privacy practices may be directed to the Operator at{' '}
        <a href="mailto:frolicmap.official@gmail.com" style={{ color: '#f59e0b' }} className="hover:underline">frolicmap.official@gmail.com</a>.
      </P>
    </LegalPage>
  )
}
