import { useRef, useState, type PointerEvent } from "react"
import {
  MODEL_OPTIONS,
  PROMPT_SLIDER_CONFIG,
  REASONING_EFFORTS,
  type ReasoningEffort,
} from "../../../../../constants"
import { useClickOutside } from "../../../../../hooks/useClickOutside"
import styles from "../PromptBar.module.scss"

type ModelPopoverTab = "effort" | "models"

const { THUMB_SIZE_PX: SLIDER_THUMB_SIZE_PX, THUMB_RADIUS_PX: SLIDER_THUMB_RADIUS_PX } =
  PROMPT_SLIDER_CONFIG

interface ModelEffortSelectorProps {
  selectedModel: string
  selectedEffort: ReasoningEffort
  onSelectModel: (model: string) => void
  onSelectEffort: (effort: ReasoningEffort) => void
}

export function ModelEffortSelector({
  selectedModel,
  selectedEffort,
  onSelectModel,
  onSelectEffort,
}: ModelEffortSelectorProps) {
  const [isOpen, setIsOpen] = useState(false)
  const [activeTab, setActiveTab] = useState<ModelPopoverTab>("effort")
  const containerRef = useRef<HTMLDivElement>(null)

  useClickOutside(containerRef, () => setIsOpen(false))

  const selectedEffortIndex = REASONING_EFFORTS.indexOf(selectedEffort)
  const sliderProgressRatio = selectedEffortIndex / (REASONING_EFFORTS.length - 1)

  const selectEffortByPointerX = (clientX: number, trackElement: HTMLDivElement) => {
    const trackRect = trackElement.getBoundingClientRect()
    const usableTrackWidth = Math.max(1, trackRect.width - SLIDER_THUMB_SIZE_PX)
    const relativeX = clientX - trackRect.left - SLIDER_THUMB_RADIUS_PX
    const clampedRatio = Math.min(1, Math.max(0, relativeX / usableTrackWidth))
    const nearestStepIndex = Math.round(clampedRatio * (REASONING_EFFORTS.length - 1))
    const nextEffort = REASONING_EFFORTS[nearestStepIndex]

    if (nextEffort) {
      onSelectEffort(nextEffort)
    }
  }

  const handleSliderPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    event.currentTarget.setPointerCapture(event.pointerId)
    selectEffortByPointerX(event.clientX, event.currentTarget)
  }

  const handleSliderPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (event.buttons !== 1) return
    selectEffortByPointerX(event.clientX, event.currentTarget)
  }

  return (
    <div ref={containerRef} style={{ position: "relative", display: "flex", alignItems: "center" }}>
      <button
        type="button"
        className={`${styles.modelSelectorButton} ${isOpen ? styles.modelSelectorActive : ""}`}
        onClick={() => {
          setIsOpen((prev) => !prev)
          setActiveTab("effort")
        }}
      >
        <span>{selectedModel}</span>
        <span className={styles.selectedEffortBadge}>{selectedEffort}</span>
        <svg width="10" height="10" viewBox="0 0 16 16" fill="none" className={styles.chevronIcon}>
          <path d="M4 6l4 4 4-4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
        </svg>
      </button>

      {isOpen && (
        <div className={styles.modelPopover}>
          {activeTab === "effort" ? (
            <div className={styles.effortPanel}>
              <div className={styles.effortPanelHeader}>
                <button
                  type="button"
                  className={styles.modelSwitchButton}
                  onClick={(event) => {
                    event.stopPropagation()
                    setActiveTab("models")
                  }}
                >
                  <span className={styles.popoverModelName}>{selectedModel}</span>
                  <span className={styles.popoverEffortName}>{selectedEffort}</span>
                  <svg
                    width="11"
                    height="11"
                    viewBox="0 0 16 16"
                    fill="none"
                    className={styles.popoverChevronIcon}
                  >
                    <path
                      d="M6 4l4 4-4 4"
                      stroke="currentColor"
                      strokeWidth="1.7"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                </button>
              </div>

              <div
                className={styles.effortSliderTrack}
                onPointerDown={handleSliderPointerDown}
                onPointerMove={handleSliderPointerMove}
              >
                <div
                  className={styles.effortSliderFill}
                  style={{
                    width: `calc(${SLIDER_THUMB_RADIUS_PX}px + ${sliderProgressRatio} * (100% - ${SLIDER_THUMB_SIZE_PX}px))`,
                  }}
                />
                <div className={styles.effortSliderSteps}>
                  {REASONING_EFFORTS.map((effortOption, stepIndex) => (
                    <span
                      key={effortOption}
                      className={`${styles.effortStepDot} ${
                        stepIndex < selectedEffortIndex ? styles.completedStep : ""
                      } ${selectedEffort === effortOption ? styles.activeStep : ""}`}
                      onClick={(event) => {
                        event.stopPropagation()
                        onSelectEffort(effortOption)
                      }}
                    />
                  ))}
                </div>
                <div
                  className={styles.effortSliderThumb}
                  style={{
                    left: `calc(${sliderProgressRatio} * (100% - ${SLIDER_THUMB_SIZE_PX}px))`,
                  }}
                />
              </div>
            </div>
          ) : (
            <div className={styles.modelListPanel}>
              <div className={styles.modelListHeader}>
                <span className={styles.modelListTitle}>Select model</span>
                <button
                  type="button"
                  className={styles.backToEffortButton}
                  onClick={(event) => {
                    event.stopPropagation()
                    setActiveTab("effort")
                  }}
                >
                  ← Effort
                </button>
              </div>
              <div className={styles.modelListSubtitle}>Recommended set of models</div>

              {MODEL_OPTIONS.map((modelOption) => {
                const isSelected = selectedModel === modelOption.name
                return (
                  <div
                    key={modelOption.name}
                    className={`${styles.modelOptionItem} ${isSelected ? styles.selected : ""}`}
                    onClick={(event) => {
                      event.stopPropagation()
                      onSelectModel(modelOption.name)
                      setActiveTab("effort")
                    }}
                  >
                    <div>
                      <div>{modelOption.name}</div>
                      <div className={styles.modelOptionDescription}>{modelOption.description}</div>
                    </div>
                    {isSelected && <span>✓</span>}
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
