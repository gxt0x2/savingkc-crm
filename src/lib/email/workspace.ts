export const emailWorkspaceSections=['inbox','campaigns','more'] as const
export type EmailWorkspaceSection=typeof emailWorkspaceSections[number]
export function sectionFromPath(path:string):EmailWorkspaceSection{return path.includes('/campaigns')?'campaigns':path.includes('/more')?'more':'inbox'}
