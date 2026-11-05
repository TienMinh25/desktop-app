import { useRef, useState } from "react"
import { APP_CONFIG } from "../../../constants"
import styles from "./TermsModal.module.scss"

interface TermsModalProps {
  onAgree: () => void
  onDisagree: () => void
}

export function TermsModal({ onAgree, onDisagree }: TermsModalProps) {
  const scrollboxRef = useRef<HTMLDivElement>(null)
  const [hasScrolledToBottom, setHasScrolledToBottom] = useState(false)
  const [agreedTerms, setAgreedTerms] = useState(false)
  const [agreedPrivacy, setAgreedPrivacy] = useState(false)

  const handleScroll = () => {
    if (hasScrolledToBottom) return
    const box = scrollboxRef.current
    if (!box) return
    if (box.scrollTop + box.clientHeight >= box.scrollHeight - 25) {
      setHasScrolledToBottom(true)
    }
  }

  const canContinue = hasScrolledToBottom && agreedTerms && agreedPrivacy

  return (
    <div className={styles.overlay}>
      <div className={styles.card} role="dialog" aria-labelledby="termsHeading">
        <div className={styles.headerRow}>
          <div className={styles.titleGroup}>
            <span id="termsHeading" className={styles.title}>
              Terms and conditions
            </span>
            <span className={styles.versionBadge}>{APP_CONFIG.TERMS_VERSION}</span>
          </div>

          <div
            className={`${styles.scrollHint} ${hasScrolledToBottom ? styles.scrollReady : ""}`}
          >
            <svg width="13" height="13" viewBox="0 0 16 16" fill="none">
              <path
                d="M8 3v10M4 9l4 4 4-4"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
            <span>
              {hasScrolledToBottom
                ? "Terms read. You can now agree to continue."
                : "Please scroll down to the bottom to enable agreement"}
            </span>
          </div>
        </div>

        <div className={styles.scrollbox} ref={scrollboxRef} onScroll={handleScroll}>
          <div className={styles.sectionTitle}>Terms and Conditions for C-CodeX Assistant</div>
          <p>
            <strong>1. Introduction</strong>
            <br />
            Welcome to C-CodeX Assistant. By using this application, you agree to the following
            terms and conditions. If you do not agree with any of these terms, please do not use the
            application.
          </p>
          <p className={styles.paragraph}>
            <strong>2. Use of the Application</strong>
            <br />• C-CodeX Assistant provides tools for programming support and learning. You are
            responsible for using the application responsibly and in compliance with applicable
            laws.
            <br />• You may not use the application for any illegal activities, fraud, or any
            actions that may harm others.
          </p>
          <p className={styles.paragraph}>
            <strong>3. Intellectual Property Rights</strong>
            <br />• All content, software, documentation, and intellectual property related to
            C-CodeX Assistant are owned by us or our licensors.
            <br />• You may not copy, distribute, or use any content without our explicit
            permission.
          </p>
          <p className={styles.paragraph}>
            <strong>4. Limitation of Liability</strong>
            <br />• We are not liable for any damages arising from the use or inability to use the
            application.
            <br />• The application may contain links to external websites. We do not control and
            are not responsible for the content of these sites.
          </p>
          <p className={styles.paragraph}>
            <strong>5. Changes to Terms</strong>
            <br />
            We reserve the right to modify these terms and conditions at any time. You should review
            them regularly for the latest updates.
          </p>
          <p className={styles.paragraph}>
            <strong>6. Contact Information</strong>
            <br />
            If you have any questions about these terms and conditions, please contact us at:{" "}
            <span className={styles.linkText}>{APP_CONFIG.SUPPORT_EMAIL}</span>.
            <br />
            By using C-CodeX Assistant, you agree to these terms and conditions.
          </p>

          <div className={styles.dashedDivider} />

          <div className={styles.sectionTitle}>
            Privacy Policy <span className={styles.policyVersion}>{APP_CONFIG.PRIVACY_VERSION}</span>
          </div>
          <p>
            <strong>Introduction:</strong> Welcome to C-CodeX Assistant. This privacy policy
            explains how we collect, use, and protect your personal information when you use this
            application.
          </p>
          <p className={styles.paragraph}>
            <strong>Information We Collect:</strong> We may collect personal information such as
            your name, email address, and information related to how you use the application. We may
            also collect non-personal information such as your IP address, browser type, and access
            times.
          </p>
          <p className={styles.paragraph}>
            <strong>How We Use Your Information:</strong> Your personal information may be used to
            improve our services, send notifications, and provide user support. We may use
            non-personal information to analyze trends and enhance user experience.
          </p>
          <p className={styles.paragraph}>
            <strong>Information Security:</strong> We are committed to protecting your personal
            information. We use reasonable security measures to prevent unauthorized access to your
            information. However, no method of transmission over the Internet or electronic storage
            is completely secure.
          </p>
          <p className={styles.paragraph}>
            <strong>Information Sharing:</strong> We do not sell, trade, or rent your personal
            information to third parties. We may share your personal information if required by law
            or to protect our rights.
          </p>
          <p className={styles.paragraph}>
            <strong>Changes to This Policy:</strong> We reserve the right to change this privacy
            policy at any time. You should review this policy periodically for the latest updates.
          </p>
          <p className={styles.paragraph}>
            <strong>Contact Information:</strong> If you have any questions about this privacy
            policy, please contact us at:{" "}
            <span className={styles.linkText}>{APP_CONFIG.SUPPORT_EMAIL}</span>.
            <br />
            By using C-CodeX Assistant, you agree to this privacy policy.
          </p>

          <div className={styles.endNotice}>
            ✓ You have reached the end of the Terms and Conditions
          </div>
        </div>

        <div className={styles.checkboxGroup}>
          <label className={`${styles.agreeItem} ${!hasScrolledToBottom ? styles.disabled : ""}`}>
            <input
              type="checkbox"
              disabled={!hasScrolledToBottom}
              checked={agreedTerms}
              onChange={(e) => setAgreedTerms(e.target.checked)}
            />
            <span>
              I have read and agree to the <span className={styles.underlineLink}>Terms of Use</span>{" "}
              *
            </span>
          </label>

          <label className={`${styles.agreeItem} ${!hasScrolledToBottom ? styles.disabled : ""}`}>
            <input
              type="checkbox"
              disabled={!hasScrolledToBottom}
              checked={agreedPrivacy}
              onChange={(e) => setAgreedPrivacy(e.target.checked)}
            />
            <span>
              I have read and agree to the{" "}
              <span className={styles.underlineLink}>Privacy Policy</span> *
            </span>
          </label>
        </div>

        <div className={styles.actions}>
          <button type="button" className={styles.disagreeBtn} onClick={onDisagree}>
            Disagree
          </button>
          <button
            type="button"
            className={styles.agreeBtn}
            disabled={!canContinue}
            onClick={onAgree}
          >
            I Agree
          </button>
        </div>
      </div>
    </div>
  )
}