import fs from 'fs'
const filePath = 'c:/Users/goret/OneDrive/Рабочий стол/Dashboard Charity/src/pages/PublicPage.tsx'

const part1 = `import { useState, useMemo } from 'react'
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
  ChevronDown
} from 'lucide-react'
import { useApp } from '@/lib/appStore'
import { formatCurrency } from '@/lib/format'
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid
} from 'recharts'

const publicChartData = [
  { name: 'Янв', donations: 180000, expenses: 140000, net: 40000 },
  { name: 'Фев', donations: 210000, expenses: 160000, net: 50000 },
  { name: 'Мар', donations: 250000, expenses: 190000, net: 60000 },
  { name: 'Апр', donations: 220000, expenses: 170000, net: 50000 },
  { name: 'Май', donations: 290000, expenses: 230000, net: 60000 },
  { name: 'Июн', donations: 270000, expenses: 210000, net: 60000 },
  { name: 'Июл', donations: 260000, expenses: 200000, net: 60000 },
  { name: 'Авг', donations: 310000, expenses: 240000, net: 70000 },
  { name: 'Сен', donations: 380000, expenses: 310000, net: 70000 },
  { name: 'Окт', donations: 350000, expenses: 280000, net: 70000 },
  { name: 'Ноя', donations: 340000, expenses: 270000, net: 70000 },
  { name: 'Дек', donations: 390000, expenses: 310000, net: 80000 }
]

const publicTransactions = [
  { id: 'p1', date: '15.12.2024', type: 'income', category: 'Благотворительность', description: 'Пожертвование', amount: 250000, doc: 'Платёжное поручение' },
  { id: 'p2', date: '14.12.2024', type: 'expense', category: 'Помощь нуждающимся', description: 'Расход', amount: 120000, doc: 'Акт о помощи' },
  { id: 'p3', date: '10.12.2024', type: 'income', category: 'Благотворительность', description: 'Пожертвование', amount: 100000, doc: 'Платёжное поручение' },
  { id: 'p4', date: '08.12.2024', type: 'expense', category: 'Медицинская помощь', description: 'Оплата лечения', amount: 180000, doc: 'Договор №42' },
  { id: 'p5', date: '05.12.2024', type: 'income', category: 'Корпоративный взнос', description: 'Благотворительный взнос', amount: 500000, doc: 'Платёжное поручение' }
]
`

fs.writeFileSync(filePath, part1, 'utf8')
console.log('Wrote part 1')
