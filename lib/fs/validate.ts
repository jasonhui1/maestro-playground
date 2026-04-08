import yaml from 'js-yaml'
import path from 'path'

export interface ValidationResult {
  valid: boolean
  error?: string
}

export function validateYaml(raw: string): ValidationResult {
  try {
    yaml.load(raw)
    return { valid: true }
  } catch (err: any) {
    return { valid: false, error: err.message }
  }
}
