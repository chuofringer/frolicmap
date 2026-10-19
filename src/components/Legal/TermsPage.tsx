import { useTranslation } from 'react-i18next'
import { LegalPage, H2, P, UL } from './LegalPage'

export default function TermsPage() {
  const { t } = useTranslation()
  return (
    <LegalPage title={t('pages.legal.termsTitle')} lastUpdated="2026-08-09">
      <P>
        These Terms of Service (the "Terms") constitute a legally binding agreement between
        the operator of funradar.app (the "Operator", "we", "us", or "our") and any
        individual or entity (the "User", "you", or "your") accessing or using the
        funradar.app website, application programming interfaces, mobile applications, and
        all related content and functionality (collectively, the "Service"). By accessing
        or using any portion of the Service, the User acknowledges having read, understood,
        and agreed to be bound by these Terms. If the User does not agree to these Terms in
        their entirety, the User shall not access or use the Service.
      </P>

      <H2>1. Definitions</H2>
      <P>
        For purposes of these Terms, the following capitalized terms shall have the
        meanings set forth below:
      </P>
      <UL>
        <li>"Content" means all data, text, listings, descriptions, photographs, categorizations, compilations, source code, design elements, and other materials made available through the Service.</li>
        <li>"Curated Database" means the structured collection of places, events, and associated metadata assembled, selected, organized, edited, verified, and presented by the Operator.</li>
        <li>"Third-Party Sources" means external data providers, including but not limited to OpenStreetMap, governmental open-data portals, and public calendar feeds, from which underlying factual data is obtained.</li>
      </UL>

      <H2>2. Description of the Service</H2>
      <P>
        The Service provides an informational, map-based directory of family- and
        child-oriented locations and events within the metropolitan areas of the United
        States that the Service covers from time to time, as listed on the Service's
        "/cities" page. The set of covered areas may be expanded, reduced, or otherwise
        modified by the Operator at any time without notice. Information presented
        through the Service is aggregated
        from Third-Party Sources and editorially reviewed prior to publication. The
        Service is provided for general informational purposes only and does not
        constitute professional advice of any kind.
      </P>

      <H2>3. Eligibility</H2>
      <P>
        Use of the Service is intended for individuals who are at least eighteen (18)
        years of age and who are legally competent to enter into binding agreements under
        the laws of their jurisdiction of residence. By using the Service, the User
        represents and warrants that the User satisfies these eligibility requirements.
        Minors shall not use the Service except under the direct supervision of a parent
        or legal guardian.
      </P>

      <H2>4. Limited License</H2>
      <P>
        Subject to and conditioned upon the User's continuing compliance with these Terms,
        the Operator grants to the User a limited, non-exclusive, non-transferable,
        non-sublicensable, revocable license to access and use the Service solely for the
        User's personal, non-commercial purposes. All rights not expressly granted herein
        are reserved by the Operator.
      </P>

      <H2>5. Restrictions on Use</H2>
      <P>
        The User shall not, and shall not permit, authorize, or facilitate any third
        party to, directly or indirectly:
      </P>
      <UL>
        <li>(a) access, scrape, crawl, harvest, mirror, index, cache, or otherwise systematically extract, copy, or reproduce any portion of the Service or the Curated Database, whether by automated means, scripts, robots, spiders, data-mining tools, or by any manual process designed to circumvent ordinary interactive use;</li>
        <li>(b) reproduce, duplicate, copy, sell, resell, license, sublicense, distribute, publicly display, publicly perform, transmit, broadcast, or otherwise exploit any portion of the Content or the Curated Database for any commercial purpose whatsoever;</li>
        <li>(c) use any portion of the Content or the Curated Database to develop, train, fine-tune, validate, benchmark, or evaluate any artificial intelligence model, machine-learning model, large language model, or any derivative dataset thereof;</li>
        <li>(d) reverse engineer, decompile, disassemble, or otherwise attempt to derive the source code, underlying ideas, algorithms, structure, or organizational form of the Service, except to the extent that such activity is expressly permitted by applicable law notwithstanding this prohibition;</li>
        <li>(e) circumvent, bypass, disable, or interfere with any security feature, rate limit, session token, access control, authentication mechanism, or other technological measure intended to protect the Service or the Curated Database;</li>
        <li>(f) use the Service or any Content to develop, populate, or operate any product, service, database, or directory that competes with the Service, or that aggregates or replicates the Curated Database in whole or in substantial part;</li>
        <li>(g) use the names, trademarks, service marks, logos, trade dress, or other distinctive branding elements of the Operator in any manner, including without limitation in any meta tags, advertising, or domain names, that suggests sponsorship, endorsement, or affiliation by or with the Operator without the Operator's prior express written consent;</li>
        <li>(h) introduce any virus, worm, trojan horse, malware, or other malicious code into the Service, or take any action that imposes an unreasonable or disproportionately large load on the infrastructure of the Service;</li>
        <li>(i) use the Service in violation of any applicable federal, state, local, or international law, regulation, or court order; or</li>
        <li>(j) remove, alter, or obscure any copyright, trademark, or other proprietary-rights notice contained in or on any portion of the Service.</li>
      </UL>

      <H2>6. Intellectual Property Rights</H2>
      <P>
        The Service, the Curated Database, and all Content (excluding the underlying
        factual data obtained from Third-Party Sources) are the exclusive property of the
        Operator and are protected by the copyright laws of the United States, the laws of
        the State of California, and applicable international treaties and conventions,
        including without limitation copyright in compilations under Section 103 of Title
        17 of the United States Code and database rights recognized under the laws of
        applicable foreign jurisdictions. The Operator asserts proprietary rights in,
        without limitation:
      </P>
      <UL>
        <li>(a) the selection, coordination, arrangement, categorization, and editorial enhancement of factual data within the Curated Database;</li>
        <li>(b) all original written descriptions, summaries, headings, taxonomies, and editorial notes;</li>
        <li>(c) the user interface, visual design, layout, color palette, and trade dress of the Service;</li>
        <li>(d) the source code, application logic, data schemas, and software architecture of the Service;</li>
        <li>(e) the names "funradar" and "funradar.app", together with all associated logos, marks, and brand elements; and</li>
        <li>(f) the methodology, processes, and editorial criteria by which Content is selected, verified, categorized, and presented.</li>
      </UL>
      <P>
        Underlying factual data obtained from Third-Party Sources remains subject to the
        terms, licenses, and conditions imposed by the respective providers thereof, and
        the Operator makes no claim of ownership in such underlying factual data
        independent of its incorporation into the Curated Database.
      </P>

      <H2>7. User Submissions</H2>
      <P>
        The User may from time to time submit reports, corrections, suggestions, comments,
        or other materials to the Operator (collectively, "Submissions"), whether through
        the Service's reporting feature, by electronic mail, or by other means. By
        transmitting any Submission, the User hereby grants to the Operator a perpetual,
        irrevocable, worldwide, royalty-free, fully paid-up, non-exclusive, transferable,
        and sublicensable license to use, reproduce, modify, adapt, publish, translate,
        create derivative works from, distribute, perform, and display such Submission, in
        whole or in part, in any media now known or hereafter developed, for any purpose
        whatsoever, without compensation to the User. The User represents and warrants
        that each Submission is accurate to the best of the User's knowledge and does not
        infringe, misappropriate, or violate any rights of any third party.
      </P>

      <H2>8. Third-Party Content and External Links</H2>
      <P>
        The Service contains hyperlinks and references to websites, applications,
        services, and content operated by third parties. The Operator does not control,
        endorse, sponsor, or assume responsibility for any third-party content, terms of
        use, privacy practices, or business practices. The User's access to and use of any
        third-party website or service shall be governed solely by the applicable terms
        and policies of such third party, and any such access or use shall be at the
        User's sole risk.
      </P>

      <H2>9. Disclaimer of Warranties</H2>
      <P>
        TO THE MAXIMUM EXTENT PERMITTED BY APPLICABLE LAW, THE SERVICE AND ALL CONTENT ARE
        PROVIDED ON AN "AS IS" AND "AS AVAILABLE" BASIS, WITHOUT WARRANTIES OF ANY KIND,
        WHETHER EXPRESS, IMPLIED, STATUTORY, OR OTHERWISE. THE OPERATOR HEREBY DISCLAIMS
        ALL WARRANTIES, INCLUDING WITHOUT LIMITATION THE IMPLIED WARRANTIES OF
        MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, TITLE, NON-INFRINGEMENT,
        ACCURACY, COMPLETENESS, RELIABILITY, AND UNINTERRUPTED OR ERROR-FREE OPERATION.
        WITHOUT LIMITING THE FOREGOING, THE OPERATOR MAKES NO REPRESENTATION OR WARRANTY
        THAT ANY LISTING, EVENT, OPERATING HOUR, PRICE, AGE SUITABILITY, OR SAFETY
        CONDITION DESCRIBED IN THE SERVICE IS CURRENT, ACCURATE, OR COMPLETE. THE USER
        SHALL INDEPENDENTLY VERIFY ALL SUCH INFORMATION DIRECTLY WITH THE APPLICABLE VENUE
        OR EVENT ORGANIZER PRIOR TO RELYING UPON IT.
      </P>

      <H2>10. Limitation of Liability</H2>
      <P>
        TO THE MAXIMUM EXTENT PERMITTED BY APPLICABLE LAW, IN NO EVENT SHALL THE OPERATOR,
        ITS AFFILIATES, OFFICERS, DIRECTORS, EMPLOYEES, CONTRACTORS, AGENTS, OR LICENSORS
        BE LIABLE TO THE USER OR TO ANY THIRD PARTY FOR ANY INDIRECT, INCIDENTAL, SPECIAL,
        CONSEQUENTIAL, EXEMPLARY, OR PUNITIVE DAMAGES, OR FOR ANY LOSS OF PROFITS,
        REVENUES, BUSINESS, GOODWILL, DATA, OR USE, ARISING OUT OF OR IN CONNECTION WITH
        THESE TERMS OR THE USE OF, OR INABILITY TO USE, THE SERVICE, REGARDLESS OF THE
        LEGAL THEORY UNDER WHICH SUCH DAMAGES ARE SOUGHT, AND WHETHER OR NOT THE OPERATOR
        HAS BEEN ADVISED OF THE POSSIBILITY OF SUCH DAMAGES. WITHOUT LIMITING THE
        FOREGOING, THE OPERATOR SHALL HAVE NO LIABILITY FOR ANY INJURY, ILLNESS, LOSS, OR
        DAMAGE SUSTAINED BY ANY PERSON AT OR IN CONNECTION WITH ANY VENUE, EVENT, OR
        ACTIVITY DESCRIBED IN THE SERVICE. THE AGGREGATE LIABILITY OF THE OPERATOR ARISING
        OUT OF OR RELATED TO THESE TERMS OR THE SERVICE SHALL NOT EXCEED ONE HUNDRED
        UNITED STATES DOLLARS (US $100.00).
      </P>

      <H2>11. Indemnification</H2>
      <P>
        The User shall indemnify, defend, and hold harmless the Operator and its
        affiliates, officers, directors, employees, contractors, agents, and licensors
        from and against any and all claims, demands, actions, proceedings, losses,
        liabilities, damages, judgments, settlements, fines, costs, and expenses
        (including reasonable attorneys' fees and court costs) arising out of or relating
        to: (a) the User's use of or access to the Service; (b) the User's breach or
        alleged breach of these Terms; (c) any Submission provided by the User; or (d)
        the User's violation of any applicable law or of any right of any third party.
      </P>

      <H2>12. Termination</H2>
      <P>
        The Operator may, in its sole discretion and without prior notice or liability to
        the User, suspend, restrict, or terminate the User's access to the Service, in
        whole or in part, for any reason or for no reason, including without limitation
        upon any actual or suspected breach of these Terms, any pattern of automated or
        excessive use, or any use that the Operator determines, in its sole judgment, to
        be competitive with the Service. The provisions of Sections 5 (Restrictions on
        Use), 6 (Intellectual Property Rights), 7 (User Submissions), 9 (Disclaimer of
        Warranties), 10 (Limitation of Liability), 11 (Indemnification), 13 (Governing
        Law and Forum), and 14 (General Provisions) shall survive any termination of
        these Terms.
      </P>

      <H2>13. Governing Law and Forum</H2>
      <P>
        These Terms, and any dispute, claim, or controversy arising out of or relating to
        these Terms or the Service (whether sounding in contract, tort, statute, or
        otherwise), shall be governed by and construed in accordance with the laws of the
        State of California, United States of America, without regard to its conflict of
        laws principles. The User and the Operator hereby irrevocably consent to the
        exclusive jurisdiction of, and venue in, the state and federal courts located in
        the City and County of San Francisco, California, for the resolution of any such
        dispute, claim, or controversy, and each party hereby waives any objection to
        such jurisdiction or venue on the grounds of inconvenient forum or otherwise.
      </P>

      <H2>14. General Provisions</H2>
      <P>
        <strong>14.1 Entire Agreement.</strong> These Terms, together with the Privacy
        Policy referenced herein, constitute the entire agreement between the User and
        the Operator with respect to the subject matter hereof and supersede all prior or
        contemporaneous understandings, communications, or agreements, whether written or
        oral.
      </P>
      <P>
        <strong>14.2 Amendments.</strong> The Operator reserves the right, in its sole
        discretion, to modify these Terms at any time. Any modification shall be effective
        upon posting to the Service, and the "Last updated" date set forth at the top of
        this document shall be revised accordingly. The User's continued use of the
        Service following any such modification shall constitute the User's acceptance of
        the modified Terms.
      </P>
      <P>
        <strong>14.3 Severability.</strong> If any provision of these Terms is held by a
        court of competent jurisdiction to be invalid, illegal, or unenforceable, such
        provision shall be modified to the minimum extent necessary to render it
        enforceable, or, if such modification is not possible, severed from these Terms,
        and the remaining provisions shall continue in full force and effect.
      </P>
      <P>
        <strong>14.4 No Waiver.</strong> The failure of the Operator to enforce any right
        or provision of these Terms shall not constitute a waiver of such right or
        provision, nor shall any single or partial exercise of any right preclude any
        other or further exercise thereof.
      </P>
      <P>
        <strong>14.5 Assignment.</strong> The User shall not assign, transfer, or delegate
        any of the User's rights or obligations under these Terms without the prior
        written consent of the Operator. The Operator may freely assign or transfer these
        Terms, in whole or in part, without restriction.
      </P>
      <P>
        <strong>14.6 No Agency.</strong> Nothing in these Terms shall be construed to
        create any partnership, joint venture, employment, agency, or fiduciary
        relationship between the parties.
      </P>
      <P>
        <strong>14.7 Notices.</strong> All notices to the Operator under these Terms shall
        be delivered in writing by electronic mail to{' '}
        <a href="mailto:frolicmap.official@gmail.com" style={{ color: '#f59e0b' }} className="hover:underline">frolicmap.official@gmail.com</a>
        {' '}and shall be deemed given upon transmission, provided no failure notice is
        received.
      </P>

      <H2>15. Contact Information</H2>
      <P>
        Inquiries regarding these Terms may be directed to the Operator at{' '}
        <a href="mailto:frolicmap.official@gmail.com" style={{ color: '#f59e0b' }} className="hover:underline">frolicmap.official@gmail.com</a>.
      </P>
    </LegalPage>
  )
}
