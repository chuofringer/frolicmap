import { useTranslation } from 'react-i18next'
import { LegalPage, H2, P, UL } from './LegalPage'

const EMAIL = 'frolicmap.official@gmail.com'

export default function TermsPage() {
  const { t } = useTranslation()
  return (
    <LegalPage title={t('pages.legal.termsTitle')} lastUpdated="2026-10-19">
      <P>
        These Terms of Service (the "Terms") govern your use of frolicmap.app and its
        related application programming interfaces (the "Service"), which is operated by
        the maintainers of frolicmap (the "Operator", "we", or "us"). By using the
        Service you agree to these Terms. If you do not agree, please do not use the
        Service.
      </P>

      <H2>1. What the Service is</H2>
      <P>
        frolicmap is a free, informational map of places that may suit families with
        children: playgrounds, parks, libraries, museums, aquariums and zoos, beaches,
        water play areas, hiking trails and campgrounds in the metropolitan areas listed
        on the Service's "/cities" page. There are no accounts, no sign-in, no
        newsletter, no advertising and no paid features. The covered areas may change at
        any time.
      </P>

      <H2>2. Information may be wrong</H2>
      <P>
        Place records come from public datasets (see Data sources below) and may be
        out of date, incomplete or mislocated. Hours, prices, age suitability,
        accessibility, closures and safety conditions can change without notice. Always
        confirm details with the venue before you travel, and use your own judgment about
        whether a place is safe and suitable for your children. Supervise children at all
        times.
      </P>

      <H2>3. Data sources and licences</H2>
      <P>
        The source code of frolicmap is open source under the MIT licence. The data shown
        on the map is not MIT-licensed: each place record keeps the licence of the
        source it came from.
      </P>
      <UL>
        <li>OpenStreetMap data is © OpenStreetMap contributors, available under the Open Database Licence (ODbL) 1.0. See openstreetmap.org/copyright.</li>
        <li>Library and museum records come from the Institute of Museum and Library Services (IMLS), a U.S. federal agency; that data is in the public domain.</li>
        <li>National park records come from the National Park Service (NPS); that data is in the public domain.</li>
        <li>Photographs, where shown, come from Wikimedia Commons and are credited to their authors under their individual Creative Commons or other licences, as stated in the credit shown with each photograph.</li>
        <li>Basemap imagery is provided by third parties (such as OpenFreeMap and the U.S. Geological Survey) under their own terms and attributions, shown in the corner of the map.</li>
      </UL>
      <P>
        If you reuse any data you obtain from the Service, you are responsible for
        complying with the licence of the underlying source, including attribution and,
        for OpenStreetMap-derived data, share-alike requirements.
      </P>

      <H2>4. Acceptable use</H2>
      <P>You agree not to:</P>
      <UL>
        <li>bypass or interfere with the Service's session tokens, rate limits or other protective measures;</li>
        <li>send automated or excessive requests that place an unreasonable load on the Service (if you need bulk data, obtain it from the original sources listed above; the open-source repository contains the import scripts that rebuild the data from those sources);</li>
        <li>introduce malicious code or attempt to gain unauthorized access to the Service or its infrastructure; or</li>
        <li>use the Service in violation of any applicable law.</li>
      </UL>

      <H2>5. Reports and feedback</H2>
      <P>
        The Service lets you report a problem with a listing by email. By sending a report or
        writing to us, you allow us to use what you send to correct or remove the listing
        and to improve the Service, without obligation to you. Please do not include
        personal information about yourself or others in a report.
      </P>

      <H2>6. Third-party links and services</H2>
      <P>
        The Service links to third-party websites and apps (for example map apps and
        venue websites) and relies on third-party map and search services. We do not
        control them and are not responsible for their content, availability or
        practices. Your use of them is governed by their own terms.
      </P>

      <H2>7. Disclaimer of warranties</H2>
      <P>
        THE SERVICE AND ALL CONTENT ARE PROVIDED "AS IS" AND "AS AVAILABLE", WITHOUT
        WARRANTIES OF ANY KIND, WHETHER EXPRESS OR IMPLIED, INCLUDING WARRANTIES OF
        ACCURACY, COMPLETENESS, MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND
        NON-INFRINGEMENT, TO THE MAXIMUM EXTENT PERMITTED BY LAW.
      </P>

      <H2>8. Limitation of liability</H2>
      <P>
        TO THE MAXIMUM EXTENT PERMITTED BY LAW, THE OPERATOR WILL NOT BE LIABLE FOR ANY
        INDIRECT, INCIDENTAL, SPECIAL, CONSEQUENTIAL OR PUNITIVE DAMAGES, OR FOR ANY
        INJURY, LOSS OR DAMAGE SUSTAINED AT OR IN CONNECTION WITH ANY PLACE LISTED ON
        THE SERVICE. THE OPERATOR'S TOTAL LIABILITY FOR ANY CLAIM RELATING TO THE SERVICE
        WILL NOT EXCEED ONE HUNDRED UNITED STATES DOLLARS (US $100).
      </P>

      <H2>9. Changes and termination</H2>
      <P>
        We may change the Service or these Terms at any time. Changes take effect when
        posted here, and the "Last updated" date above will change. Continuing to use the
        Service after a change means you accept the updated Terms. We may suspend or
        block access to the Service for anyone who abuses it.
      </P>

      <H2>10. Governing law</H2>
      <P>
        These Terms are governed by the laws of the State of California, United States,
        without regard to its conflict-of-laws rules.
      </P>

      <H2>11. Contact</H2>
      <P>
        Questions about these Terms can be sent to{' '}
        <a href={`mailto:${EMAIL}`} style={{ color: '#f59e0b' }} className="hover:underline">{EMAIL}</a>.
      </P>
    </LegalPage>
  )
}
