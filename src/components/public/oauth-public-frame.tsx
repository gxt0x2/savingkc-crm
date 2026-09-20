import Image from 'next/image'
import Link from 'next/link'
import type { ReactNode } from 'react'
import styles from './oauth-public-frame.module.css'

export function OauthPublicFrame({ children }: { children: ReactNode }) {
  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <div className={`${styles.inner} ${styles.brandRow}`}>
          <Link href="/product" className={styles.brand}>
            <Image
              src="/logo.png"
              alt="Saving KC Homebuyers"
              width={160}
              height={46}
              className="h-9 w-auto"
            />
            <span className={styles.brandText}>
              <span className={styles.brandName}>Saving KC CRM</span>
              <span className={styles.brandMeta}>Staff operations software</span>
            </span>
          </Link>
          <nav className={styles.nav} aria-label="Public CRM pages">
            <Link href="/product">Product</Link>
            <Link href="/privacy">Privacy</Link>
            <Link href="/terms">Terms</Link>
            <Link href="/login">Staff sign in</Link>
          </nav>
        </div>
      </header>
      <main className={styles.main}>{children}</main>
      <footer className={styles.footer}>
        <div className={styles.footerInner}>
          <p className={styles.footerCopy}>
            © 2026 Saving KC Homebuyers LLC · 7021 NW Winter Ave, Kansas City, MO 64152
          </p>
          <div className={styles.footerLinks}>
            <Link href="/product">Product</Link>
            <Link href="/privacy">Privacy Policy</Link>
            <Link href="/terms">Terms</Link>
            <a href="mailto:support@savingkc.com">support@savingkc.com</a>
          </div>
        </div>
      </footer>
    </div>
  )
}
