import { test,expect } from '@playwright/test'
test('contact rules show scope and give visible confirmation after saving',async({page})=>{
 const id='00000000-0000-4000-8000-000000000099'
 let body:Record<string,unknown>|null=null
 await page.route('**/api/email/contact-rules**',async route=>{
  if(route.request().method()==='POST'){body=route.request().postDataJSON();await route.fulfill({json:{state:'Outreach held for everyone linked to this property.'}})}
  else await route.fulfill({json:{hash:'a'.repeat(64),person:{display_name:'Jamie',status:null},addresses:[{id,email:'jamie@example.test',slot:1,relationship:'confirmed',stopped:false}],properties:[{id,address:'123 Test Street',active:false,reason:null}]}})
 })
 await page.setViewportSize({width:360,height:800})
 await page.goto('/contact-rules')
 await page.getByText('Contact rules',{exact:true}).click()
 await expect(page.getByText('Primary: jamie@example.test')).toBeVisible()
 await page.getByLabel('Change',{exact:true}).selectOption('hold_property')
 await expect(page.getByText('Pauses campaign emails to all linked people. It does not unsubscribe them.')).toBeVisible()
 await page.getByLabel('Reason / evidence').fill('Representative asked to pause outreach')
 await page.getByRole('button',{name:'Hold everyone at this property'}).click()
 await expect(page.getByRole('status')).toHaveText('Outreach held for everyone linked to this property.')
 expect(body).toMatchObject({threadId:id,action:'hold_property',propertyId:id,expectedHash:'a'.repeat(64)})
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true)
})
