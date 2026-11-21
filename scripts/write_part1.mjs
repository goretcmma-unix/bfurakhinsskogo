import fs from 'fs'

const p1 = `import { useState, useMemo } from 'react'
import {
  Globe,
  Check,
  Search,
  Calendar,
  Filter,
  Download,
  ArrowUpRight,
  ArrowDownRight,
  ExternalLink,
  Heart,
  ShieldCheck,
  Scale,
  Coins,
  ChevronDown,
  QrCode,
  Smartphone,
  Send
} from 'lucide-react'
import { useApp } from '@/lib/appStore'
import { formatCurrency } from '@/lib/format'
import { Modal, Field, inputCls } from '@/components/ui/Modal'
import {
  AreaChart,
  Area,
  Bar,
  ComposedChart,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid
} from 'recharts'

const publicChartData = [
  { name: 'Янв', donations: 120000, expenses: 90000 },
  { name: 'Фев', donations: 150000, expenses: 110000 },
  { name: 'Мар', donations: 180000, expenses: 130000 },
  { name: 'Апр', donations: 140000, expenses: 100000 },
  { name: 'Май', donations: 210000, expenses: 160000 },
  { name: 'Июн', donations: 190000, expenses: 140000 },
  { name: 'Июл', donations: 180000, expenses: 130000 },
  { name: 'Авг', donations: 220000, expenses: 170000 },
  { name: 'Сен', donations: 280000, expenses: 220000 },
  { name: 'Окт', donations: 260000, expenses: 200000 },
  { name: 'Ноя', donations: 250000, expenses: 190000 },
  { name: 'Дек', donations: 320000, expenses: 250000 }
]

const publicTransactions = [
  { id: 'p1', date: '15.12.2024', type: 'income', category: 'Благотворительность', description: 'Пожертвование', amount: 250000, doc: 'Платёжное поручение' },
  { id: 'p2', date: '14.12.2024', type: 'expense', category: 'Помощь нуждающимся', description: 'Расход', amount: 120000, doc: 'Акт о помощи' },
  { id: 'p3', date: '10.12.2024', type: 'income', category: 'Благотворительность', description: 'Пожертвование', amount: 100000, doc: 'Платёжное поручение' },
  { id: 'p4', date: '08.12.2024', type: 'expense', category: 'Медицинская помощь', description: 'Оплата лечения', amount: 180000, doc: 'Договор №42' },
  { id: 'p5', date: '05.12.2024', type: 'income', category: 'Корпоративный взнос', description: 'Благотворительный взнос', amount: 500000, doc: 'Платёжное поручение' }
]
`

fs.writeFileSync('c:/Users/goret/OneDrive/Рабочий стол/Dashboard Charity/src/pages/PublicPage.tsx', p1, 'utf8')
console.log('Part 1 written')
