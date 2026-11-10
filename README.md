# Agency Client Hub

Build a simple CRM web app for small agencies. Several companies can sign up and use it. Each company has its own team members, clients and documents. Features: (1) Sign up and log in with email and password. When someone signs up they create their company, or join an existing company with an invite code. (2) Two roles: admin and member. Admins can invite members, delete clients and see a "Company settings" page with billing notes. Members can add and edit clients. (3) Clients list with name, email, phone, status (lead, active, lost), notes and the team member who owns it. Search and filter by status. (4) Each client can have uploaded documents (PDF contracts, invoices) that the team can download. (5) A dashboard with the number of clients by status. (6) An "Export all clients" button that downloads a CSV. Keep the design clean and professional. Save all data in a database.

This project was built with [Lovable](https://lovable.dev).

## Build with Lovable

Continue developing this project in the [Lovable editor](https://lovable.dev/projects/65881114-0ca0-4a78-9a38-0246507d158c).

- **Ship faster**: describe what you want to build and Lovable handles the code.
- **Stay in sync**: every change made in Lovable is committed straight to this repository.
- **Full ownership**: this code is yours. Push to `main` on GitHub and your changes sync back into Lovable, ready for your next prompt.

## Development

Prefer working locally? You need Node.js and npm — [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating).

```sh
git clone <this-repository-url>
cd <repository-name>
npm i
npm run dev
```
