import type { UtilityProcess } from "electron"
import { HARNESS_EVENT_TYPES } from "../../contracts/message-types"

interface HarnessLifecycleOptions {
  fork: () => UtilityProcess
  configure: (child: UtilityProcess) => Promise<void>
  onMessage: (child: UtilityProcess, message: unknown) => void
  onUnexpectedExit: () => void
  readyTimeoutMs: number
  stopTimeoutMs: number
}

interface RunningHarness {
  child: UtilityProcess
  ready: boolean
  stopping: boolean
}

export class HarnessLifecycle {
  private current: RunningHarness | null = null
  private operations = Promise.resolve()

  constructor(private readonly options: HarnessLifecycleOptions) {}

  get alive(): boolean {
    return this.current !== null
  }

  get readyProcess(): UtilityProcess | null {
    return this.current?.ready && !this.current.stopping ? this.current.child : null
  }

  ensure(): Promise<UtilityProcess> {
    return this.serialize(async () => {
      if (this.readyProcess) return this.readyProcess
      if (this.current) throw new Error("The previous harness process is still stopping.")

      const child = this.options.fork()
      const running = { child, ready: false, stopping: false }
      this.current = running
      try {
        await this.waitForReady(running)
        await this.options.configure(child)
        if (this.current !== running) throw new Error("Harness exited during configuration.")
        running.ready = true
        return child
      } catch (error) {
        if (this.current === running) await this.stopProcess(running)
        throw error
      }
    })
  }

  stop(): Promise<void> {
    return this.serialize(async () => {
      if (this.current) await this.stopProcess(this.current)
    })
  }

  private serialize<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.operations.then(operation)
    this.operations = result.then(() => undefined, () => undefined)
    return result
  }

  private waitForReady(running: RunningHarness): Promise<void> {
    const { child } = running
    return new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(`Harness did not become ready within ${this.options.readyTimeoutMs} ms.`))
      }, this.options.readyTimeoutMs)
      child.on("message", (message: unknown) => {
        if (this.current !== running || running.stopping) return
        if (message && typeof message === "object" && "type" in message && message.type === HARNESS_EVENT_TYPES.HARNESS_READY) {
          clearTimeout(timer)
          resolve()
        } else if (running.ready) {
          this.options.onMessage(child, message)
        }
      })
      child.once("exit", (code) => {
        this.current = null
        clearTimeout(timer)
        reject(new Error(`Harness exited before becoming ready (code ${code}).`))
        if (!running.stopping) this.options.onUnexpectedExit()
      })
    })
  }

  private stopProcess(running: RunningHarness): Promise<void> {
    const { child } = running
    const alreadyStopping = running.stopping
    running.stopping = true
    // Keep tracking the writer until exit, even if the stop wait times out.
    return new Promise<void>((resolve) => {
      const finish = () => {
        clearTimeout(timer)
        child.off("exit", finish)
        resolve()
      }
      const timer = setTimeout(finish, this.options.stopTimeoutMs)
      child.once("exit", finish)
      if (!alreadyStopping) child.kill()
    })
  }
}
