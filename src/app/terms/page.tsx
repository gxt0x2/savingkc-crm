export const metadata = {
  title: 'Terms & Conditions | Saving KC',
  description: 'Terms and Conditions for Saving KC Homebuyers LLC',
};

export default function TermsPage() {
  return (
    <div className="min-h-screen bg-gray-50 py-12 px-4 sm:px-6 lg:px-8">
      <div className="max-w-3xl mx-auto bg-white shadow-sm rounded-lg p-8">
        <h1 className="text-3xl font-bold text-gray-900 mb-2">Terms & Conditions</h1>
        <p className="text-sm text-gray-500 mb-8">Last updated April 16, 2026</p>

        <div className="prose prose-gray max-w-none space-y-6">
          <p>
            Welcome to Saving KC Homebuyers LLC. By using our website,
            submitting a property inquiry, or communicating with us, you agree
            to these Terms & Conditions.
          </p>

          <section>
            <h2 className="text-xl font-semibold text-gray-900 mt-8 mb-4">Consent to Receive SMS Messages</h2>
            <p>
              By submitting your contact information to Saving KC Homebuyers or
              requesting a property offer, you agree to receive SMS messages
              related to your property inquiry, offer details, appointment
              confirmations, and other service-related notifications.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-gray-900 mt-8 mb-4">Services</h2>
            <p>
              Saving KC Homebuyers provides real estate services to property
              owners in the Kansas City metro area, including cash offers on
              residential and land properties, assistance with inherited
              properties, and solutions for tax-delinquent real estate.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-gray-900 mt-8 mb-4">Opt-Out Policy</h2>
            <p>
              You may opt out of receiving text messages at any time by replying
              STOP. After opting out, you will no longer receive SMS updates but
              may still receive email or phone communications as part of your
              service agreement.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-gray-900 mt-8 mb-4">Message Frequency and Rates</h2>
            <p>
              Message frequency will vary depending on your property inquiry and
              account activity. Message and data rates may apply according to
              your mobile carrier&apos;s plan.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-gray-900 mt-8 mb-4">HELP and STOP Instructions</h2>
            <p>
              Reply HELP at any time for assistance. Reply STOP at any time to
              unsubscribe from SMS communications.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-gray-900 mt-8 mb-4">Supported Carriers</h2>
            <p>
              Messaging services are supported on all major US carriers. Carriers
              are not liable for delayed or undelivered messages.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-gray-900 mt-8 mb-4">Support and Contact</h2>
            <p>
              For questions about these Terms or assistance with SMS
              communications, please contact us at{' '}
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
