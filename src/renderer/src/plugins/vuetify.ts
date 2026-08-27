import 'vuetify/styles'
import { createVuetify } from 'vuetify'
import * as components from 'vuetify/components'
import * as directives from 'vuetify/directives'

export const vuetify = createVuetify({
  components,
  directives,
  theme: {
    defaultTheme: 'light',
    themes: {
      light: {
        dark: false,
        colors: {
          primary: '#1565C0',
          secondary: '#00897B',
          accent: '#FF6F00',
          error: '#D32F2F',
          warning: '#F57C00',
          info: '#0288D1',
          success: '#2E7D32',
          background: '#FAFAFA',
          surface: '#FFFFFF'
        }
      },
      dark: {
        dark: true,
        colors: {
          primary: '#42A5F5',
          secondary: '#4DB6AC',
          accent: '#FFB74D',
          error: '#EF5350',
          warning: '#FFA726',
          info: '#29B6F6',
          success: '#66BB6A',
          background: '#121212',
          surface: '#1E1E1E'
        }
      }
    }
  },
  defaults: {
    VBtn: { variant: 'flat', density: 'compact' },
    VTextField: { variant: 'outlined', density: 'compact' },
    VSelect: { variant: 'outlined', density: 'compact' },
    VSwitch: { color: 'primary', density: 'compact' },
    VSlider: { color: 'primary' },
    VCard: { elevation: 0 },
    VList: { density: 'compact' },
    VListItem: { density: 'compact' },
    VChip: { size: 'small' },
    VAlert: { density: 'compact' }
  }
})
