export const metadata = {
  title: 'Privacy Policy | Saving KC',
  description: 'Privacy Policy for Saving KC Homebuyers LLC',
};

export default function PrivacyPage() {
  return (
    <div className="min-h-screen bg-gray-50 py-12 px-4 sm:px-6 lg:px-8">
      <div className="max-w-3xl mx-auto bg-white shadow-sm rounded-lg p-8">
        <h1 className="text-3xl font-bold text-gray-900 mb-2">Privacy Policy</h1>
        <p className="text-sm text-gray-500 mb-8">Last updated April 16, 2026</p>

        <div className="prose prose-gray max-w-none space-y-6">
          <p>
            Saving KC Homebuyers LLC (&quot;we,&quot; &quot;us,&quot; or &quot;our&quot;) is committed to
            protecting your privacy. This Privacy Policy describes how we
            collect, use, disclose, and protect your personal information when
            you use our real estate services, website, and related offerings
            (collectively, the &quot;Services&quot;).
          </p>

          <p>
            By using our Services, you agree to the terms of this Privacy Policy.
          </p>

          <section>
            <h2 className="text-xl font-semibold text-gray-900 mt-8 mb-4">SMS Communications</h2>
            <p>
              Saving KC Homebuyers may use text messaging (SMS) to communicate
              with property owners regarding property inquiries, offer details,
              appointment confirmations, and other service-related information.
              By providing your phone number and opting in through our website
              form, inbound call, or inbound text message, you consent to receive
              SMS messages from Saving KC Homebuyers.
            </p>
            <p className="mt-4">
              Message frequency may vary based on your inquiry activity. Standard
              message and data rates may apply. You may opt out of SMS
              communications at any time by replying STOP to any message. Reply
              HELP for assistance.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-gray-900 mt-8 mb-4">Data Use and Sharing</h2>
            <p>
              We respect your privacy. Your contact information, including your
              mobile number, will only be used to provide the services you
              requested and will not be sold, rented, or shared with any third
              parties for marketing purposes. Mobile information will not be
              shared with third parties or affiliates for marketing or promotional
              purposes. Saving KC Homebuyers may share limited data with
              contracted service providers solely for the purpose of delivering
              real estate services or managing communication systems (e.g.,
              Twilio).
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-gray-900 mt-8 mb-4">Data Security</h2>
            <p>
              We implement reasonable administrative, technical, and physical
              safeguards to protect client information against unauthorized
              access, alteration, or disclosure.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-gray-900 mt-8 mb-4">Contact</h2>
            <p>
              For questions about this Privacy Policy, please contact us at{' '}
              <a href="mailto:support@savingkc.com" className="text-blue-600 hover:underline">
                support@savingkc.com
              </a>{' '}
              or{' '}
              <a href="tel:+18164292900" className="text-blue-600 hover:underline">
                (816) 429-2900
              </a>.
            </p>
            <p className="mt-4">
              Saving KC Homebuyers LLC<br />
              7021 NW Winter Ave<br />
              Kansas City, MO 64152
            </p>
          </section>
        </div>
      </div>
    </div>
  );
}
