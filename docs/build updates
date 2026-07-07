# Fatima Bakery Build Updates

For Front-end Updates
For future Fatima Bakery site updates, use this simple workflow:
1. Always start from the latest main
From local repo folder:
cd ~Documents/GitHub/fatimabakery
git checkout main
git pull origin main

This makes sure to have latest live version.
2. Create a new branch for each update
Use a descriptive branch name:

git checkout -b update-market-date

or:

git checkout -b update-menu-july

Examples:
update-market-date
update-loaf-reserve-copy
update-menu-pricing
update-local-seo
fix-order-form

3. Edit the files locally
For the current repo, you’ll usually edit:
index.html
order/index.html
contact/index.html
collection/index.html
story/index.html
README.md
wrangler.jsonc

For images:
images/

Avoid editing anything backend-secret related in this repo.
4. Check what changed
git status
git diff

Search your site text when needed:
grep -R "Pilgrim" .
grep -R "Loaf Reserve" .
grep -R "newsletter" .
grep -R "August 6" .

5. Commit the update
git add .
git commit -m "Update market date and Loaf Reserve copy"

6. Push the branch
Since you’re using SSH now, make sure the key is loaded first:

eval "$(ssh-agent -s)"
ssh-add ~/.ssh/ssh_key

Then push:
git push -u origin update-market-date

7. Open a Pull Request
Go to GitHub:

realjkg/fatimabakery → Pull requests → New pull request

Set:

base: main
compare: your-update-branch

Review the changes, then merge into main.
8. Cloudflare deploys automatically
Because Cloudflare is connected to main, once you merge into main, Cloudflare should build/deploy automatically.
Check:

Cloudflare → Workers & Pages → fatima-bakery → Deployments

You want to see the latest build marked successful.

The repeatable command pattern

cd ~Documents/GitHub/fatimabakery

git checkout main
git pull origin main

git checkout -b update-description-here

# edit files

git status
git diff

git add .
git commit -m "Describe the update"

eval "$(ssh-agent -s)"
ssh-add ~/.ssh/ssh_key

git push -u origin update-description-here

For Back-end updates:

When to update Apps Script separately
Cloudflare/GitHub updates are for the front end only.
Use Google Apps Script separately when changing:
	•	Order routing
	•	Email confirmations
	•	Square webhook behavior
	•	Sheet writing
	•	Payment confirmation logic
	•	Spam/bot filtering
	•	Menu item backend keys
