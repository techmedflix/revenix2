import type { Account, AccountType } from '@prisma/client'

export type AccountTreeNode = Account & { children: AccountTreeNode[] }

export function buildAccountTree(accounts: Account[]) {
  const map = new Map(accounts.map((a) => [a.id, { ...a, children: [] as AccountTreeNode[] }]))
  const roots: AccountTreeNode[] = []

  for (const node of map.values()) {
    if (node.parentId) {
      map.get(node.parentId)?.children.push(node)
    } else {
      roots.push(node)
    }
  }

  return roots
}

export function findAncestorByType(
  accountId: string,
  accountsById: Map<string, Account>,
  type: AccountType,
): Account | null {
  let current = accountsById.get(accountId) || null

  while (current) {
    if (current.type === type) return current
    current = current.parentId ? accountsById.get(current.parentId) || null : null
  }

  return null
}

export function accountPath(accountId: string, accountsById: Map<string, Account>) {
  const names: string[] = []
  let current = accountsById.get(accountId) || null
  while (current) {
    names.unshift(current.name)
    current = current.parentId ? accountsById.get(current.parentId) || null : null
  }
  return names
}
