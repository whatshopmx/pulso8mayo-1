export type StepCategory =
 | 'TEXT' | 'NUMBER' | 'YESNO' | 'SELECT' | 'PHOTO'
 | 'CHECKBOX' | 'TIME' | 'TIMER' | 'SIGNATURE' | 'LOCATION'
 | 'AUDIO' | 'VIDEO' | 'INFO' | 'DATE' | 'STOCK_COUNT';

export type BuilderStepType =
 | 'text' | 'number' | 'yes_no' | 'multiple_choice' | 'photo' | 'checklist'
 | 'TimeField' | 'TemperatureField' | 'SignatureField' | 'OPSLocationField' | 'PhotoField' | 'timer'
 | 'video' | 'audio' | 'instruction'
 | 'Text' | 'Number' | 'Photo' | 'Checkbox' | 'Select' | 'Signature'
 | 'Title' | 'SubTitle' | 'Paragraph' | 'Separator' | 'Textarea' | 'DateTime'
 | 'Radio'
 | 'SignatureField' | 'TimeField' | 'CheckboxField' | 'ChecklistField'
 | 'TextField' | 'NumberField' | 'PhotoField' | 'TemperatureField'
 | 'GPSLocationField' | 'OPSLocationField' | 'YesNo' | 'Heading'
 | 'TimerField' | 'STOCK_COUNT';

export const STEP_TYPE_TO_CATEGORY: Record<string, StepCategory> = {
  'STOCK_COUNT': 'STOCK_COUNT',
  'text': 'TEXT', 'Text': 'TEXT', 'TextField': 'TEXT', 'Textarea': 'TEXT', 'textarea': 'TEXT',
  'TEXT': 'TEXT',

  'number': 'NUMBER', 'Number': 'NUMBER', 'NumberField': 'NUMBER', 'TemperatureField': 'NUMBER',
  'NUMBER': 'NUMBER',

  'yes_no': 'YESNO', 'YesNo': 'YESNO',
  'YESNO': 'YESNO',

  'multiple_choice': 'SELECT', 'Select': 'SELECT', 'select': 'SELECT', 'Radio': 'SELECT', 'SELECT': 'SELECT',

  'photo': 'PHOTO', 'Photo': 'PHOTO', 'PhotoField': 'PHOTO',
  'PHOTO': 'PHOTO',

  'checklist': 'CHECKBOX', 'ChecklistField': 'CHECKBOX', 'Checkbox': 'CHECKBOX', 'CheckboxField': 'CHECKBOX', 'checkbox': 'CHECKBOX',
  'CHECKBOX': 'CHECKBOX',

  'TimeField': 'TIME', 'DateTime': 'TIME',
  'TIME': 'TIME',

  'timer': 'TIMER', 'TimerField': 'TIMER',
  'TIMER': 'TIMER',

  'SignatureField': 'SIGNATURE', 'Signature': 'SIGNATURE',
  'SIGNATURE': 'SIGNATURE',

  'OPSLocationField': 'LOCATION', 'GPSLocationField': 'LOCATION',
  'LOCATION': 'LOCATION',

  'audio': 'AUDIO',
  'AUDIO': 'AUDIO',

  'video': 'VIDEO', 'Video': 'VIDEO',
  'VIDEO': 'VIDEO',

  'instruction': 'INFO', 'Heading': 'INFO', 'heading': 'INFO', 'Title': 'INFO', 'SubTitle': 'INFO',
  'Paragraph': 'INFO', 'ParagraphField': 'INFO', 'Separator': 'INFO',
  'INFO': 'INFO',

  'date': 'DATE', 'DATE': 'DATE',
};

export function getStepCategory(type: string): StepCategory {
 return STEP_TYPE_TO_CATEGORY[type] || 'TEXT';
}

export const STEP_TYPE_TO_EXECUTOR_TYPE: Record<string, string> = {
  'STOCK_COUNT': 'STOCK_COUNT',
  'text': 'TEXT', 'Text': 'TEXT', 'TextField': 'TEXT', 'Textarea': 'TEXT', 'textarea': 'TEXT',
  'number': 'NUMBER', 'Number': 'NUMBER', 'NumberField': 'NUMBER', 'TemperatureField': 'NUMBER',
  'yes_no': 'SELECT', 'YesNo': 'SELECT',
  'multiple_choice': 'SELECT', 'Select': 'SELECT', 'select': 'SELECT', 'Radio': 'SELECT', 'SELECT': 'SELECT',
  'photo': 'PHOTO', 'Photo': 'PHOTO', 'PhotoField': 'PHOTO',
  'checklist': 'CHECKBOX', 'ChecklistField': 'CHECKBOX', 'Checkbox': 'CHECKBOX', 'CheckboxField': 'CHECKBOX', 'checkbox': 'CHECKBOX',
  'TimeField': 'TIME', 'DateTime': 'TIME', 'date': 'DATE',
  'timer': 'TIMER', 'TimerField': 'TIMER',
  'SignatureField': 'SIGNATURE', 'Signature': 'SIGNATURE',
  'OPSLocationField': 'LOCATION', 'GPSLocationField': 'LOCATION',
  'instruction': 'INFO', 'Heading': 'INFO', 'heading': 'INFO', 'Title': 'INFO', 'SubTitle': 'INFO',
  'Paragraph': 'INFO', 'ParagraphField': 'INFO', 'Separator': 'INFO',
  'video': 'VIDEO', 'Video': 'VIDEO', 'audio': 'AUDIO',
};

export function normalizeStepType(type: string): string {
 return STEP_TYPE_TO_EXECUTOR_TYPE[type] || 'TEXT';
}

export function normalizeOptions(options: any): string[] {
 if (!options || !Array.isArray(options)) return [];
 return options.map((opt: any) => {
  if (typeof opt === 'string') return opt;
  if (opt && typeof opt === 'object') {
   return opt.label || opt.value || String(opt);
  }
  return String(opt);
 });
}

export const STEP_TYPE_DISPLAY: Record<string, string> = {
  'STOCK_COUNT': 'Conteo de inventario',
  'text': 'Text Input', 'Text': 'Text Input', 'TextField': 'Text Input', 'Textarea': 'Text Area', 'textarea': 'Text Area',
  'TEXT': 'Text Input',
  'number': 'Number', 'Number': 'Number', 'NumberField': 'Number', 'TemperatureField': 'Temperature',
  'NUMBER': 'Number',
  'yes_no': 'Yes/No', 'YesNo': 'Yes/No',
  'YESNO': 'Yes/No',
  'multiple_choice': 'Multiple Choice', 'Select': 'Select', 'select': 'Select', 'Radio': 'Radio',
  'SELECT': 'Select',
  'photo': 'Photo', 'Photo': 'Photo', 'PhotoField': 'Photo',
  'PHOTO': 'Photo',
  'checklist': 'Checklist', 'ChecklistField': 'Checklist', 'Checkbox': 'Checkbox', 'CheckboxField': 'Checkbox', 'checkbox': 'Checkbox',
  'CHECKBOX': 'Checklist',
  'TimeField': 'Time', 'DateTime': 'Date/Time',
  'TIME': 'Time',
  'timer': 'Timer', 'TimerField': 'Timer',
  'TIMER': 'Timer',
  'DATE': 'Date/Time',
  'SignatureField': 'Signature', 'Signature': 'Signature',
  'SIGNATURE': 'Signature',
  'OPSLocationField': 'GPS Location', 'GPSLocationField': 'GPS Location',
  'LOCATION': 'GPS Location',
  'instruction': 'Instruction', 'Heading': 'Heading', 'Title': 'Title', 'SubTitle': 'Subtitle',
  'Paragraph': 'Paragraph', 'Separator': 'Separator',
  'INFO': 'Instruction',
  'video': 'Video', 'Video': 'Video',
  'VIDEO': 'Video',
  'audio': 'Audio', 'Audio': 'Audio',
  'AUDIO': 'Audio',
};
