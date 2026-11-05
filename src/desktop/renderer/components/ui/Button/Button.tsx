import type { ButtonHTMLAttributes, ReactNode } from "react"
import styles from "./Button.module.scss"

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "primary" | "secondary" | "danger"
  children: ReactNode
}

export function Button({ variant = "primary", className = "", children, ...props }: ButtonProps) {
  return (
    <button className={`${styles.button} ${styles[variant]} ${className}`.trim()} {...props}>
      {children}
    </button>
  )
}