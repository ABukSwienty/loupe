import { Loader2Icon, PlayIcon } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { JobSummary } from '@/components/job-summary'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { queueStep } from '@/lib/analysis'
import { ANALYSIS_STEPS, type AnalysisStep, type Job } from '@/lib/api'

// Optional body fields per step, as accepted by AnalysisController. Fields
// left empty are omitted, so the backend applies its defaults. Values aren't
// checked here, so the backend's 400s can be tried out.
type Field =
  | { key: string; label: string; kind: 'text' | 'number'; placeholder?: string }
  | { key: string; label: string; kind: 'select'; options: string[] }

const FIELDS: Record<AnalysisStep, Field[]> = {
  transcribe: [{ key: 'language', label: 'Language', kind: 'text', placeholder: 'auto-detect, e.g. en' }],
  diarize: [
    { key: 'numSpeakers', label: 'Speakers', kind: 'number', placeholder: 'any' },
    { key: 'minSpeakers', label: 'Min speakers', kind: 'number', placeholder: 'any' },
    { key: 'maxSpeakers', label: 'Max speakers', kind: 'number', placeholder: 'any' },
  ],
  scenes: [
    { key: 'detector', label: 'Detector', kind: 'select', options: ['adaptive', 'content'] },
    { key: 'threshold', label: 'Threshold', kind: 'number', placeholder: "detector's default" },
    { key: 'keyframeWidth', label: 'Keyframe width', kind: 'number', placeholder: '512' },
  ],
  ocr: [],
  embedTranscript: [],
  embedScenes: [],
}

function toBody(fields: Field[], values: Record<string, string>): Record<string, unknown> {
  const body: Record<string, unknown> = {}
  for (const field of fields) {
    const value = values[field.key]?.trim()
    if (!value) continue
    body[field.key] = field.kind === 'number' && !Number.isNaN(Number(value)) ? Number(value) : value
  }
  return body
}

export function AnalysisStepCard({
  videoId,
  step,
  latestJob,
  result,
}: {
  videoId: string
  step: AnalysisStep
  latestJob: Job | undefined
  /** A one-line summary of the stored result; null if the step hasn't run. */
  result: string | null
}) {
  const { title, path, needs } = ANALYSIS_STEPS[step]
  const fields = FIELDS[step]
  const [values, setValues] = useState<Record<string, string>>({})
  const [pending, setPending] = useState(false)

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setPending(true)
    await queueStep(videoId, step, toBody(fields, values))
    setPending(false)
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>
          <code className="font-mono">POST /videos/:id/{path}</code> · needs {needs}
        </CardDescription>
        <CardAction>
          {result ? (
            <Badge variant="secondary" className="max-w-48 truncate" title={result}>
              {result}
            </Badge>
          ) : <Badge variant="outline">not run</Badge>}
        </CardAction>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <form onSubmit={onSubmit} className="flex flex-col gap-3">
          {fields.length > 0 && (
            <div className="grid gap-3 sm:grid-cols-3">
              {fields.map((field) => (
                <div key={field.key} className="flex flex-col gap-1.5">
                  <Label htmlFor={`${step}-${field.key}`}>{field.label}</Label>
                  {field.kind === 'select' ? (
                    <Select
                      value={values[field.key] ?? field.options[0]}
                      onValueChange={(v) => setValues((s) => ({ ...s, [field.key]: v }))}
                    >
                      <SelectTrigger id={`${step}-${field.key}`} className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {field.options.map((o) => (
                          <SelectItem key={o} value={o}>
                            {o}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  ) : (
                    <Input
                      id={`${step}-${field.key}`}
                      inputMode={field.kind === 'number' ? 'decimal' : undefined}
                      placeholder={field.placeholder}
                      value={values[field.key] ?? ''}
                      onChange={(e) => setValues((s) => ({ ...s, [field.key]: e.target.value }))}
                    />
                  )}
                </div>
              ))}
            </div>
          )}
          <Button type="submit" size="sm" className="w-fit" disabled={pending}>
            {pending ? <Loader2Icon className="animate-spin" /> : <PlayIcon />}
            Run
          </Button>
        </form>
        {latestJob && <JobSummary job={latestJob} />}
      </CardContent>
    </Card>
  )
}
