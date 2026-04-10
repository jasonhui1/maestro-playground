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

export function validateContext(filename: string, content: string): ValidationResult {
  if (!filename || filename.trim() === '') {
    return { valid: false, error: 'Filename is required' }
  }
  if (!content || content.trim() === '') {
    return { valid: false, error: 'Content is required' }
  }
  // Slug-like: alphanumeric, dashes, underscores, and dots
  if (!/^[a-z0-9-_.]+$/i.test(filename)) {
    return { valid: false, error: 'Filename must be slug-like (alphanumeric, dashes, underscores, dots)' }
  }
  return { valid: true }
}
