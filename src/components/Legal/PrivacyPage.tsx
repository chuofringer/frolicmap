import { useTranslation } from 'react-i18next'
import { LegalPage, H2, P, UL } from './LegalPage'

const EMAIL = 'frolicmap.official@gmail.com'

export default function PrivacyPage() {
  const { t } = useTranslation()
  return (
    <LegalPage title={t('pages.legal.privacyTitle')} lastUpdated="2026-10-19">
      <P>
        This Privacy Policy explains what information frolicmap.app (the "Service",
        operated by the "Operator", "we" or "us") handles when you use it. In short:
        there are no accounts, no sign-in, no newsletter, no advertising and no
        affiliate links, and we do not build profiles of visitors.
      </P>

      <H2>1. What we collect</H2>
      <UL>
        <li>
          <strong>A session token.</strong> When the page loads, the Service issues your
          browser a signed, anonymous token that lasts five minutes and is refreshed
          while the page is open. It contains only a timestamp, a random value and a
          signature. It is kept in your browser's memory only: it is not written to
          storage, not sent as a cookie, and cannot be used to recognise you across
          visits or devices.
        </li>
        <li>
          <strong>Reports you submit.</strong> If you use "Report an issue" on a place,
          we store the place's identifier, the reason you chose, the optional note you
          typed, and the time. No account, name or email address is attached. Please do
          not put personal information in the note.
        </li>
        <li>
          <strong>Request data for security.</strong> Our hosting provider, Cloudflare,
          sees your IP address when it routes your request, and we use it transiently to
          apply rate limits. To detect bulk scraping of place records, we keep a one-way
          SHA-256 hash of the IP address (not the address itself) together with a short
          counter of recent place lookups. We do not keep long-term request logs or build
          a behavioural profile of any visitor.
        </li>
        <li>
          <strong>Email you send us.</strong> If you write to {EMAIL}, your address and
          message are held by our email provider so we can reply. We do not use them for
          marketing.
        </li>
      </UL>

      <H2>2. What stays in your browser</H2>
      <P>
        frolicmap does not set cookies. It stores a few preferences in your browser's
        local storage or session storage: your chosen map style and language, and whether
        you have already seen the legend hint. This information never leaves your device
        and you can clear it at any time in your browser settings. Our hosting provider
        Cloudflare may itself use a strictly necessary security cookie (for example to
        tell automated traffic from people); we do not control or use it for tracking.
      </P>

      <H2>3. Location</H2>
      <P>
        If you tap "Near me", your browser asks for your permission to read your device's
        location. The coordinates are used only inside your browser to centre the map and
        sort or filter places by distance. They are not sent to our servers, logged or
        stored. You can withdraw the permission at any time in your browser or device
        settings. As with any web map, the map tiles your browser requests reveal the
        general area you are viewing.
      </P>

      <H2>4. Analytics</H2>
      <P>
        We may use Cloudflare Web Analytics to count page views. It does not use cookies,
        does not track you across sites and does not fingerprint your device. The beacon is
        only loaded when the Operator has configured it, and browser ad-blockers can
        block it. No other analytics service is used and no information about your
        activity on the map is sent to our own servers.
      </P>

      <H2>5. Third parties</H2>
      <P>
        Your browser contacts the following independent third parties when you use
        the Service. Each receives the information a browser normally sends with a
        request (such as your IP address and browser type) and handles it under its own
        privacy policy:
      </P>
      <UL>
        <li>basemap tile providers, such as CARTO, OpenFreeMap and Esri, which serve the map imagery;</li>
        <li>OpenStreetMap's Nominatim geocoding service, which receives the text you type into the address search;</li>
        <li>Wikimedia Commons (upload.wikimedia.org), which serves place photographs when one is shown;</li>
        <li>Cloudflare, which hosts and secures the Service; and</li>
        <li>the map apps and venue websites you choose to open through links on the Service, which receive standard referral information when you follow a link.</li>
      </UL>
      <P>
        We do not sell your information and do not share it for advertising.
      </P>

      <H2>6. Data sources</H2>
      <P>
        Place information on the map comes from public datasets, not from visitors:
        OpenStreetMap (© OpenStreetMap contributors, ODbL 1.0), the Institute of Museum
        and Library Services, the National Park Service, and the Trust for Public Land's
        ParkServe, with photographs from Wikimedia Commons credited to their authors.
        These datasets describe places, not people. See the Terms of Service for the
        licence details.
      </P>

      <H2>7. Children</H2>
      <P>
        The Service is meant for adults choosing activities for children. We do not
        knowingly collect personal information from children under 13. If you believe a
        child has sent us personal information, contact {EMAIL} and we will delete it.
      </P>

      <H2>8. Retention</H2>
      <P>
        Reports are kept while they are being reviewed and may be kept afterwards as an
        editorial record of corrections. Hashed IP lookup counters are kept only as long
        as needed for abuse protection. Session tokens are never stored on our side.
        Email correspondence is kept for as long as needed to answer you.
      </P>

      <H2>9. Your rights</H2>
      <P>
        Because we hold no account data, there is usually no personal information we can
        link to you. If you believe we hold information about you (for example an email
        you sent or a note in a report) and want it corrected or deleted, write to{' '}
        <a href={`mailto:${EMAIL}`} style={{ color: '#f59e0b' }} className="hover:underline">{EMAIL}</a>
        {' '}and we will respond within a reasonable time. Depending on where you live,
        you may have additional rights under laws such as the California Consumer
        Privacy Act or the GDPR.
      </P>

      <H2>10. Security and transfers</H2>
      <P>
        Traffic between your browser and the Service uses HTTPS. The administrative
        interface is restricted to authorized personnel. The Service is operated from the
        United States, and information it processes may be handled in the United States
        or wherever our service providers operate.
      </P>

      <H2>11. Changes</H2>
      <P>
        We may update this policy. Changes take effect when posted here and the "Last
        updated" date above will change.
      </P>

      <H2>12. Contact</H2>
      <P>
        Questions about this policy can be sent to{' '}
        <a href={`mailto:${EMAIL}`} style={{ color: '#f59e0b' }} className="hover:underline">{EMAIL}</a>.
      </P>
    </LegalPage>
  )
}
